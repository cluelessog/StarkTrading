import type { MBIData, MBIRegime, MBISource } from '../models/market.js';
import type { DatabaseAdapter } from '../db/adapter.js';
import { Queries } from '../db/queries.js';
import { classifyRegime, classifyFromBreadth } from './regime-classifier.js';
import { withFallback } from '../utils/fallback.js';
import type { BreadthCalculator, BreadthResult } from '../market/breadth-calculator.js';
import type { ChartinkClient, ChartinkBreadthData } from '../api/chartink.js';

// ---------------------------------------------------------------------------
// MBI Sheet Client (Google Sheets gviz CSV endpoint)
// ---------------------------------------------------------------------------

const GVIZ_BASE = 'https://docs.google.com/spreadsheets/d';

export interface MBISheetConfig {
  sheetId: string;
  sheetGid?: string;
}

export async function fetchMBIFromSheet(
  config: MBISheetConfig,
): Promise<MBIData> {
  const url = `${GVIZ_BASE}/${config.sheetId}/gviz/tq?tqx=out:csv&gid=${config.sheetGid ?? '0'}`;

  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(`Sheet fetch HTTP ${res.status}`);
  }

  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.includes('text/html')) {
    throw new Error('Got HTML instead of CSV — sheet may require login');
  }

  const csv = await res.text();
  return parseSheetCSV(csv);
}

function parseSheetCSV(csv: string): MBIData {
  const lines = csv.split('\n').filter((l) => l.trim());
  if (lines.length < 2) throw new Error('Sheet CSV too short');

  // Parse header and latest row
  const headers = lines[0].split(',').map((h) => h.replace(/"/g, '').trim().toLowerCase());
  const values = lines[lines.length - 1].split(',').map((v) => v.replace(/"/g, '').trim());

  const get = (name: string): string | undefined => {
    const idx = headers.findIndex((h) => h.includes(name));
    return idx >= 0 ? values[idx] : undefined;
  };

  const num = (name: string): number | undefined => {
    const v = get(name);
    return v ? parseFloat(v) : undefined;
  };

  const today = new Date().toISOString().slice(0, 10);

  return {
    date: get('date') ?? today,
    capturedAt: 'eod',
    source: 'sheet' as MBISource,
    em: num('em') ?? num('effective') ?? null,
    pct52WH: num('52wh') ?? num('52 week high') ?? 0,
    pct52WL: num('52wl') ?? num('52 week low') ?? 0,
    ratio4_5: num('4:5') ?? num('ratio') ?? 0,
    pctAbove20SMA: num('20sma') ?? num('20 sma'),
    pctAbove50SMA: num('50sma') ?? num('50 sma'),
    pctAbove200SMA: num('200sma') ?? num('200 sma'),
    pctBelow200SMA: undefined,
    fetchedAt: new Date().toISOString(),
    dataFreshness: 'fresh',
  };
}

// ---------------------------------------------------------------------------
// MBI Data Manager — orchestrates fetch + classify + store
// 3-tier fallback: Sheet → breadth_only → stale_cache
// (Chartink is in the chain but is a stub that throws)
// ---------------------------------------------------------------------------

export class MBIDataManager {
  private queries: Queries;

  constructor(
    private db: DatabaseAdapter,
    private sheetConfig: MBISheetConfig,
    private breadthCalculator?: BreadthCalculator,
    private chartinkClient?: ChartinkClient,
  ) {
    this.queries = new Queries(db);
  }

  async getLatestRegime(): Promise<{
    regime: MBIRegime;
    mbi: MBIData;
    source: string;
  }> {
    // Try cache first
    const cached = this.queries.getLatestMBI();
    const today = new Date().toISOString().slice(0, 10);

    if (cached && cached.date === today && cached.dataFreshness === 'fresh') {
      const regime = cached.em != null
        ? classifyRegime(cached.em)
        : classifyFromBreadth(cached);
      return { regime, mbi: cached, source: `cached:${cached.source}` };
    }

    // Fetch fresh data with fallback chain
    const result = await withFallback(this.buildFallbackChain(cached));

    const mbi = result.value;

    // Store in DB
    this.queries.upsertMBIDaily({
      date: mbi.date,
      capturedAt: mbi.capturedAt,
      source: mbi.source,
      em: mbi.em ?? undefined,
      pct52WH: mbi.pct52WH,
      pct52WL: mbi.pct52WL,
      ratio4_5: mbi.ratio4_5,
      pctAbove20SMA: mbi.pctAbove20SMA,
      pctAbove50SMA: mbi.pctAbove50SMA,
      pctAbove200SMA: mbi.pctAbove200SMA,
      pctBelow200SMA: mbi.pctBelow200SMA,
      rawSourceJson: mbi.rawSourceJson,
      dataFreshness: mbi.dataFreshness,
    });

    const regime = mbi.em != null
      ? classifyRegime(mbi.em)
      : classifyFromBreadth(mbi);

    return { regime, mbi, source: result.source };
  }

  /**
   * Force a fresh fetch, ignoring today's cache. Used by morning workflow.
   */
  async refreshMBI(): Promise<{
    regime: MBIRegime;
    mbi: MBIData;
    source: string;
  }> {
    const cached = this.queries.getLatestMBI();

    const result = await withFallback(this.buildFallbackChain(cached));
    const mbi = result.value;

    this.queries.upsertMBIDaily({
      date: mbi.date,
      capturedAt: mbi.capturedAt,
      source: mbi.source,
      em: mbi.em ?? undefined,
      pct52WH: mbi.pct52WH,
      pct52WL: mbi.pct52WL,
      ratio4_5: mbi.ratio4_5,
      pctAbove20SMA: mbi.pctAbove20SMA,
      pctAbove50SMA: mbi.pctAbove50SMA,
      pctAbove200SMA: mbi.pctAbove200SMA,
      pctBelow200SMA: mbi.pctBelow200SMA,
      rawSourceJson: mbi.rawSourceJson,
      dataFreshness: mbi.dataFreshness,
    });

    const regime = mbi.em != null
      ? classifyRegime(mbi.em)
      : classifyFromBreadth(mbi);

    return { regime, mbi, source: result.source };
  }

  /**
   * Build the fallback chain: Sheet → Chartink → breadth_only → stale_cache.
   */
  private buildFallbackChain(cached: MBIData | null) {
    return [
      {
        name: 'sheet',
        fn: () => fetchMBIFromSheet(this.sheetConfig),
      },
      {
        name: 'chartink',
        fn: async (): Promise<MBIData> => {
          if (!this.chartinkClient) {
            throw new Error('No Chartink client configured');
          }
          const breadth = await this.chartinkClient.fetchBreadthData();
          return this.chartinkBreadthToMBIData(breadth);
        },
      },
      {
        name: 'breadth_only',
        fn: async (): Promise<MBIData> => {
          if (!this.breadthCalculator) {
            throw new Error('No BreadthCalculator configured');
          }
          if (!this.breadthCalculator.isWarm()) {
            throw new Error('BreadthCalculator not warm (insufficient OHLCV history)');
          }
          const breadth = await this.breadthCalculator.calculateBreadth();
          return this.breadthResultToMBIData(breadth);
        },
      },
      {
        name: 'stale_cache',
        fn: async (): Promise<MBIData> => {
          const stale = cached ?? this.queries.getLatestMBIDaily();
          if (stale) {
            return {
              ...stale,
              dataFreshness: 'stale' as const,
              source: 'stale_cache' as MBISource,
            };
          }
          throw new Error('No cached MBI data');
        },
      },
    ];
  }

  /**
   * Convert ChartinkBreadthData to MBIData (em is always null).
   */
  private chartinkBreadthToMBIData(breadth: ChartinkBreadthData): MBIData {
    const today = new Date().toISOString().slice(0, 10);
    return {
      date: today,
      capturedAt: 'eod',
      source: 'chartink',
      em: null,
      pct52WH: breadth.pct52WH,
      pct52WL: breadth.pct52WL,
      ratio4_5: breadth.ratio4_5,
      pctAbove20SMA: breadth.pctAbove20SMA,
      pctAbove50SMA: breadth.pctAbove50SMA,
      pctAbove200SMA: breadth.pctAbove200SMA,
      rawSourceJson: breadth.rawHtml,
      fetchedAt: breadth.fetchedAt,
      dataFreshness: 'fresh',
    };
  }

  /**
   * Convert BreadthResult to MBIData (em is always null).
   */
  private breadthResultToMBIData(breadth: BreadthResult): MBIData {
    const today = new Date().toISOString().slice(0, 10);
    return {
      date: today,
      capturedAt: 'eod',
      source: 'breadth_only',
      em: null,
      pct52WH: breadth.pct52WH,
      pct52WL: breadth.pct52WL,
      ratio4_5: breadth.ratio4_5,
      pctAbove20SMA: breadth.pctAbove20SMA,
      pctAbove50SMA: breadth.pctAbove50SMA,
      pctAbove200SMA: breadth.pctAbove200SMA,
      pctBelow200SMA: breadth.pctBelow200SMA,
      f10: breadth.f10,
      f20: breadth.f20,
      f50: breadth.f50,
      fetchedAt: new Date().toISOString(),
      dataFreshness: 'fresh',
    };
  }
}
