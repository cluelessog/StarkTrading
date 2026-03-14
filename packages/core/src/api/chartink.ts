// ---------------------------------------------------------------------------
// Chartink Client — Stub for v1
// ---------------------------------------------------------------------------
// The full interface is defined so the slot exists in the MBI fallback chain.
// Future: implement actual scraping with HTML parsing, browser-like User-Agent,
// 10s timeout, and raw HTML caching.

export interface ChartinkConfig {
  dashboardId: string;  // default: '291317'
  timeoutMs: number;    // default: 10000
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

export class ChartinkClient {
  constructor(private config: ChartinkConfig) {}

  /**
   * Fetch breadth data from Chartink dashboard.
   * Stub: always throws — the withFallback chain catches this and moves
   * to the next fallback (breadth_only).
   */
  async fetchBreadthData(): Promise<ChartinkBreadthData> {
    throw new Error(
      'Chartink scraper not yet implemented -- use Sheet or breadth_only fallback',
    );
  }
}
