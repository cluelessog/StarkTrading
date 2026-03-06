import type { MBIData, MBIRegime, MBISource } from '../models/market.js';
import type { DatabaseAdapter } from '../db/adapter.js';
import { Queries } from '../db/queries.js';
import { classifyRegime, classifyFromBreadth } from './regime-classifier.js';
import { withFallback } from '../utils/fallback.js';

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
// ---------------------------------------------------------------------------

export class MBIDataManager {
  private queries: Queries;

  constructor(
    private db: DatabaseAdapter,
    private sheetConfig: MBISheetConfig,
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
    const result = await withFallback([
      {
        name: 'sheet',
        fn: () => fetchMBIFromSheet(this.sheetConfig),
      },
      {
        name: 'cached_stale',
        fn: async () => {
          if (cached) return { ...cached, dataFreshness: 'stale' as const };
          throw new Error('No cached MBI data');
        },
      },
    ]);

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
      rawSourceJson: undefined,
      dataFreshness: mbi.dataFreshness,
    });

    const regime = mbi.em != null
      ? classifyRegime(mbi.em)
      : classifyFromBreadth(mbi);

    return { regime, mbi, source: result.source };
  }
}
