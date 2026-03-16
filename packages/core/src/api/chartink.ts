// ---------------------------------------------------------------------------
// Chartink Client — Scrapes market breadth data from chartink.com
// ---------------------------------------------------------------------------
// Uses Chartink's internal POST /screener/process endpoint with scan_clause
// queries. Requires a session (cookies + CSRF token) obtained from GET /screener/.
// This is the secondary fallback in the MBI data chain (after Google Sheet).

const CHARTINK_BASE = 'https://chartink.com';
const SCREENER_URL = `${CHARTINK_BASE}/screener/`;
const PROCESS_URL = `${CHARTINK_BASE}/screener/process`;

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// {57960} = NSE universe
const SCAN_CLAUSES = {
  above200SMA: '( {57960} ( latest close > latest sma( latest close , 200 ) ) )',
  above50SMA: '( {57960} ( latest close > latest sma( latest close , 50 ) ) )',
  above20SMA: '( {57960} ( latest close > latest sma( latest close , 20 ) ) )',
  high52W: '( {57960} ( latest close >= max( 252 , latest high ) ) )',
  low52W: '( {57960} ( latest close <= min( 252 , latest low ) ) )',
  totalNSE: '( {57960} ( latest close > 0 ) )',
} as const;

export interface ChartinkConfig {
  dashboardId: string; // default: '291317' (unused now — we use scan_clause directly)
  timeoutMs: number; // default: 10000
}

export interface ChartinkBreadthData {
  pct52WH: number;
  pct52WL: number;
  pctAbove20SMA: number;
  pctAbove50SMA: number;
  pctAbove200SMA: number;
  ratio4_5: number;
  rawHtml?: string;
  fetchedAt: string;
}

interface ChartinkProcessResponse {
  data: Array<Record<string, unknown>>;
  scan_series_count?: number;
}

export class ChartinkClient {
  private csrfToken: string | null = null;
  private cookies: string | null = null;

  constructor(private config: ChartinkConfig) {}

  /**
   * Fetch breadth data from Chartink using scan_clause queries.
   * Runs 6 scans: above 200/50/20 SMA, 52w high/low, total NSE count.
   * Computes percentages and returns ChartinkBreadthData.
   */
  async fetchBreadthData(): Promise<ChartinkBreadthData> {
    // Step 1: Establish session (CSRF token + cookies)
    await this.initSession();

    // Step 2: Run all scans (sequentially to respect rate limits)
    const counts = await this.runAllScans();

    // Step 3: Compute percentages
    const total = counts.totalNSE;
    if (total === 0) {
      throw new Error('Chartink returned 0 total NSE stocks — scan may have failed');
    }

    const pct = (count: number) => Math.round((count / total) * 10000) / 100; // 2 decimal places

    const advancers = counts.above200SMA;
    const decliners = total - advancers;
    const ratio4_5 = decliners > 0 ? Math.round((advancers / decliners) * 100) / 100 : 99;

    return {
      pct52WH: pct(counts.high52W),
      pct52WL: pct(counts.low52W),
      pctAbove20SMA: pct(counts.above20SMA),
      pctAbove50SMA: pct(counts.above50SMA),
      pctAbove200SMA: pct(counts.above200SMA),
      ratio4_5,
      rawHtml: JSON.stringify(counts),
      fetchedAt: new Date().toISOString(),
    };
  }

  /**
   * GET /screener/ to extract CSRF token from <meta name="csrf-token"> and session cookies.
   */
  private async initSession(): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const res = await fetch(SCREENER_URL, {
        headers: { 'User-Agent': BROWSER_UA },
        signal: controller.signal,
        redirect: 'follow',
      });

      if (!res.ok) {
        throw new Error(`Chartink session init HTTP ${res.status}`);
      }

      // Extract cookies from response
      const setCookie = res.headers.getSetCookie?.() ?? [];
      this.cookies = setCookie
        .map((c) => c.split(';')[0])
        .join('; ');

      // Extract CSRF token from HTML
      const html = await res.text();
      const csrfMatch = html.match(/<meta\s+name="csrf-token"\s+content="([^"]+)"/);
      if (!csrfMatch) {
        throw new Error('Could not extract CSRF token from Chartink page');
      }
      this.csrfToken = csrfMatch[1];
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Run all scan clauses and return stock counts for each.
   */
  private async runAllScans(): Promise<Record<keyof typeof SCAN_CLAUSES, number>> {
    const results = {} as Record<keyof typeof SCAN_CLAUSES, number>;

    for (const [key, clause] of Object.entries(SCAN_CLAUSES)) {
      results[key as keyof typeof SCAN_CLAUSES] = await this.runScan(clause);
    }

    return results;
  }

  /**
   * POST /screener/process with a scan_clause and return the count of matching stocks.
   */
  private async runScan(scanClause: string): Promise<number> {
    if (!this.csrfToken) {
      throw new Error('Chartink session not initialized — call initSession() first');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const body = new URLSearchParams({ scan_clause: scanClause });

      const headers: Record<string, string> = {
        'User-Agent': BROWSER_UA,
        'X-CSRF-TOKEN': this.csrfToken,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Referer': SCREENER_URL,
      };
      if (this.cookies) {
        headers['Cookie'] = this.cookies;
      }

      const res = await fetch(PROCESS_URL, {
        method: 'POST',
        headers,
        body: body.toString(),
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new Error(`Chartink scan HTTP ${res.status} for clause: ${scanClause.slice(0, 60)}...`);
      }

      const json = (await res.json()) as ChartinkProcessResponse;
      return json.data?.length ?? 0;
    } finally {
      clearTimeout(timeout);
    }
  }
}
