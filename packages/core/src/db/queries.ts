import type { DatabaseAdapter } from './adapter';
import type { WatchlistStock, WatchlistPriority } from '../models/stock';
import type { OHLCVBar } from '../models/intervals';
import type { StockScore, ScoreBreakdown } from '../models/score';
import type { MBIData, MBISource, MBIRegime, MarketContext } from '../models/market';

// ---------------------------------------------------------------------------
// Row shapes returned from SQLite (snake_case columns)
// ---------------------------------------------------------------------------

interface WatchlistStockRow {
  id: number;
  watchlist_id: number;
  symbol: string;
  token: string;
  name: string;
  priority: number;
  added_at: string;
}

interface OHLCVRow {
  symbol: string;
  interval: string;
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  fetched_at: string;
}

interface StockScoreRow {
  id: number;
  symbol: string;
  token: string;
  name: string;
  scoring_session_id: string;
  status: 'PARTIAL' | 'COMPLETE';
  ep_catalyst: number | null;
  sector_strength: number | null;
  high_rs: number | null;
  ipo_recency: number | null;
  thrust_power: number | null;
  pivot_location: number | null;
  pattern_quality: number | null;
  pivot_level_proximity: number | null;
  linearity: number | null;
  not_pivot_cutter: number | null;
  aoi: number | null;
  hve_hvy: number | null;
  hvq_2_5: number | null;
  algorithmic_score: number;
  discretionary_score: number;
  total_score: number;
  max_possible_score: number;
  override_count: number;
  score_breakdown_json: string | null;
  data_freshness: 'fresh' | 'stale';
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}

interface MBIDailyRow {
  date: string;
  captured_at: string;
  source: MBISource;
  em: number | null;
  pct_52wh: number | null;
  pct_52wl: number | null;
  ratio_4_5: number | null;
  pct_above_20sma: number | null;
  pct_above_50sma: number | null;
  pct_above_200sma: number | null;
  pct_below_200sma: number | null;
  f10: number | null;
  f20: number | null;
  f50: number | null;
  raw_source_json: string | null;
  fetched_at: string;
  data_freshness: 'fresh' | 'stale';
}

interface TradeJournalRow {
  id: number;
  symbol: string;
  trade_type: 'swing' | 'intraday';
  entry_date: string;
  entry_price: number;
  shares: number;
  stop_price: number | null;
  risk_amount: number | null;
  exit_date: string | null;
  exit_price: number | null;
  exit_reason: string | null;
  pnl: number | null;
  r_multiple: number | null;
  hold_days: number | null;
  score_at_entry: number | null;
  score_breakdown_json: string | null;
  market_regime_at_entry: string | null;
  sector_at_entry: string | null;
  conviction: string | null;
  override_count: number;
  status: 'OPEN' | 'CLOSED';
  created_at: string;
}

interface MarketContextRow {
  id: number;
  date: string;
  nifty_close: number | null;
  nifty_50dma: number | null;
  nifty_200dma: number | null;
  mbi_regime: string | null;
  mbi_em: number | null;
  mbi_source: string | null;
  created_at: string;
}

interface ApiUsageRow {
  service: string;
  call_count: number;
}

interface PositionRow {
  id: number;
  symbol: string;
  trade_type: 'swing' | 'intraday';
  entry_date: string;
  entry_price: number;
  shares: number;
  stop_price: number | null;
  risk_amount: number | null;
  status: 'OPEN' | 'CLOSED';
  created_at: string;
}

export interface Position {
  id: number;
  symbol: string;
  tradeType: 'swing' | 'intraday';
  entryDate: string;
  entryPrice: number;
  shares: number;
  stopPrice: number | null;
  riskAmount: number | null;
  status: 'OPEN' | 'CLOSED';
  createdAt: string;
}

// Input shapes for insert methods
export interface TradeJournalEntry {
  id: number;
  symbol: string;
  tradeType: 'swing' | 'intraday';
  entryDate: string;
  entryPrice: number;
  shares: number;
  stopPrice: number | null;
  riskAmount: number | null;
  exitDate: string | null;
  exitPrice: number | null;
  exitReason: string | null;
  pnl: number | null;
  rMultiple: number | null;
  holdDays: number | null;
  scoreAtEntry: number | null;
  scoreBreakdownJson: string | null;
  marketRegimeAtEntry: string | null;
  sectorAtEntry: string | null;
  conviction: string | null;
  overrideCount: number;
  status: 'OPEN' | 'CLOSED';
  createdAt: string;
}

export interface InsertWatchlistStockData {
  watchlistId: number;
  symbol: string;
  token: string;
  name: string;
  priority: WatchlistPriority;
}

export interface UpsertOHLCVData {
  symbol: string;
  interval: string;
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface InsertStockScoreData {
  symbol: string;
  token: string;
  name: string;
  scoringSessionId: string;
  status: 'PARTIAL' | 'COMPLETE';
  breakdown: ScoreBreakdown;
  overrideCount: number;
  dataFreshness: 'fresh' | 'stale';
  reviewedAt?: string;
  // Individual factor values
  epCatalyst?: number;
  sectorStrength?: number;
  highRs?: number;
  ipoRecency?: number;
  thrustPower?: number;
  pivotLocation?: number;
  patternQuality?: number;
  pivotLevelProximity?: number;
  linearity?: number;
  notPivotCutter?: number;
  aoi?: number;
  hveHvy?: number;
  hvq2_5?: number;
}

export interface InsertTradeData {
  symbol: string;
  tradeType: 'swing' | 'intraday';
  entryDate: string;
  entryPrice: number;
  shares: number;
  stopPrice?: number;
  riskAmount?: number;
  scoreAtEntry?: number;
  scoreBreakdownJson?: string;
  marketRegimeAtEntry?: string;
  sectorAtEntry?: string;
  conviction?: 'HIGH' | 'MEDIUM' | 'LOW';
  overrideCount?: number;
}

export interface CloseTradeData {
  exitDate: string;
  exitPrice: number;
  exitReason: 'STOPPED' | 'TARGET' | 'DISCRETION' | 'INVALIDATED';
  pnl: number;
  rMultiple: number;
  holdDays: number;
}

export interface UpsertMBIData {
  date: string;
  capturedAt: string;
  source: MBISource;
  em?: number;
  pct52WH?: number;
  pct52WL?: number;
  ratio4_5?: number;
  pctAbove20SMA?: number;
  pctAbove50SMA?: number;
  pctAbove200SMA?: number;
  pctBelow200SMA?: number;
  f10?: number;
  f20?: number;
  f50?: number;
  rawSourceJson?: string;
  dataFreshness: 'fresh' | 'stale';
}

// ---------------------------------------------------------------------------
// Row mappers
// ---------------------------------------------------------------------------

function rowToWatchlistStock(row: WatchlistStockRow): WatchlistStock {
  return {
    id: row.id,
    watchlistId: row.watchlist_id,
    symbol: row.symbol,
    token: row.token,
    name: row.name,
    priority: row.priority as WatchlistPriority,
    addedAt: row.added_at,
  };
}

function rowToOHLCVBar(row: OHLCVRow): OHLCVBar {
  return {
    timestamp: row.date,
    open: row.open,
    high: row.high,
    low: row.low,
    close: row.close,
    volume: row.volume,
  };
}

function rowToStockScore(row: StockScoreRow): StockScore {
  const breakdown: ScoreBreakdown = row.score_breakdown_json
    ? (JSON.parse(row.score_breakdown_json) as ScoreBreakdown)
    : {
        factors: [],
        algorithmicScore: row.algorithmic_score,
        discretionaryScore: row.discretionary_score,
        totalScore: row.total_score,
        maxPossibleScore: row.max_possible_score,
      };
  return {
    id: row.id,
    symbol: row.symbol,
    token: row.token,
    name: row.name,
    scoringSessionId: row.scoring_session_id,
    status: row.status,
    breakdown,
    overrideCount: row.override_count,
    reviewedAt: row.reviewed_at ?? undefined,
    dataFreshness: row.data_freshness,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToMBIData(row: MBIDailyRow): MBIData {
  return {
    date: row.date,
    capturedAt: row.captured_at,
    source: row.source,
    em: row.em,
    pct52WH: row.pct_52wh ?? 0,
    pct52WL: row.pct_52wl ?? 0,
    ratio4_5: row.ratio_4_5 ?? 0,
    pctAbove20SMA: row.pct_above_20sma ?? undefined,
    pctAbove50SMA: row.pct_above_50sma ?? undefined,
    pctAbove200SMA: row.pct_above_200sma ?? undefined,
    pctBelow200SMA: row.pct_below_200sma ?? undefined,
    f10: row.f10 ?? undefined,
    f20: row.f20 ?? undefined,
    f50: row.f50 ?? undefined,
    rawSourceJson: row.raw_source_json ?? undefined,
    fetchedAt: row.fetched_at,
    dataFreshness: row.data_freshness,
  };
}

function rowToTradeJournal(row: TradeJournalRow): TradeJournalEntry {
  return {
    id: row.id,
    symbol: row.symbol,
    tradeType: row.trade_type,
    entryDate: row.entry_date,
    entryPrice: row.entry_price,
    shares: row.shares,
    stopPrice: row.stop_price,
    riskAmount: row.risk_amount,
    exitDate: row.exit_date,
    exitPrice: row.exit_price,
    exitReason: row.exit_reason,
    pnl: row.pnl,
    rMultiple: row.r_multiple,
    holdDays: row.hold_days,
    scoreAtEntry: row.score_at_entry,
    scoreBreakdownJson: row.score_breakdown_json,
    marketRegimeAtEntry: row.market_regime_at_entry,
    sectorAtEntry: row.sector_at_entry,
    conviction: row.conviction,
    overrideCount: row.override_count,
    status: row.status,
    createdAt: row.created_at,
  };
}

function rowToPosition(row: PositionRow): Position {
  return {
    id: row.id,
    symbol: row.symbol,
    tradeType: row.trade_type,
    entryDate: row.entry_date,
    entryPrice: row.entry_price,
    shares: row.shares,
    stopPrice: row.stop_price,
    riskAmount: row.risk_amount,
    status: row.status,
    createdAt: row.created_at,
  };
}

function rowToMarketContext(row: MarketContextRow): MarketContext {
  return {
    id: row.id,
    date: row.date,
    niftyClose: row.nifty_close ?? 0,
    nifty50DMA: row.nifty_50dma ?? 0,
    nifty200DMA: row.nifty_200dma ?? 0,
    mbiRegime: (row.mbi_regime as MBIRegime) ?? undefined,
    mbiEm: row.mbi_em,
    mbiSource: (row.mbi_source as MBISource) ?? undefined,
    createdAt: row.created_at,
  };
}

// ---------------------------------------------------------------------------
// Queries class
// ---------------------------------------------------------------------------

export class Queries {
  constructor(private readonly db: DatabaseAdapter) {}

  // --- Watchlists ---

  insertWatchlist(name: string): number {
    this.db.execute('INSERT INTO watchlists (name) VALUES (?)', [name]);
    const row = this.db.queryOne<{ id: number }>(
      'SELECT last_insert_rowid() AS id'
    );
    return row!.id;
  }

  insertWatchlistStock(data: InsertWatchlistStockData): number {
    this.db.execute(
      `INSERT INTO watchlist_stocks (watchlist_id, symbol, token, name, priority)
       VALUES (?, ?, ?, ?, ?)`,
      [data.watchlistId, data.symbol, data.token, data.name, data.priority]
    );
    const row = this.db.queryOne<{ id: number }>(
      'SELECT last_insert_rowid() AS id'
    );
    return row!.id;
  }

  getWatchlistStocks(
    watchlistId: number,
    priority?: number
  ): WatchlistStock[] {
    if (priority !== undefined) {
      const rows = this.db.query<WatchlistStockRow>(
        `SELECT * FROM watchlist_stocks
         WHERE watchlist_id = ? AND priority = ?
         ORDER BY priority DESC, added_at ASC`,
        [watchlistId, priority]
      );
      return rows.map(rowToWatchlistStock);
    }
    const rows = this.db.query<WatchlistStockRow>(
      `SELECT * FROM watchlist_stocks
       WHERE watchlist_id = ?
       ORDER BY priority DESC, added_at ASC`,
      [watchlistId]
    );
    return rows.map(rowToWatchlistStock);
  }

  // --- OHLCV Cache ---

  upsertOHLCV(data: UpsertOHLCVData): void {
    this.db.execute(
      `INSERT INTO ohlcv_cache (symbol, interval, date, open, high, low, close, volume)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(symbol, interval, date) DO UPDATE SET
         open = excluded.open,
         high = excluded.high,
         low = excluded.low,
         close = excluded.close,
         volume = excluded.volume,
         fetched_at = datetime('now')`,
      [
        data.symbol,
        data.interval,
        data.date,
        data.open,
        data.high,
        data.low,
        data.close,
        data.volume,
      ]
    );
  }

  getOHLCV(
    symbol: string,
    interval: string,
    from: string,
    to: string
  ): OHLCVBar[] {
    const rows = this.db.query<OHLCVRow>(
      `SELECT * FROM ohlcv_cache
       WHERE symbol = ? AND interval = ? AND date >= ? AND date <= ?
       ORDER BY date ASC`,
      [symbol, interval, from, to]
    );
    return rows.map(rowToOHLCVBar);
  }

  isOHLCVFresh(symbol: string, interval: string, date: string): boolean {
    const row = this.db.queryOne<{ count: number }>(
      `SELECT COUNT(*) AS count FROM ohlcv_cache
       WHERE symbol = ? AND interval = ? AND date = ?`,
      [symbol, interval, date]
    );
    return (row?.count ?? 0) > 0;
  }

  // --- Stock Scores ---

  insertStockScore(data: InsertStockScoreData): number {
    this.db.execute(
      `INSERT INTO stock_scores (
         symbol, token, name, scoring_session_id, status,
         ep_catalyst, sector_strength, high_rs, ipo_recency,
         thrust_power, pivot_location, pattern_quality, pivot_level_proximity,
         linearity, not_pivot_cutter, aoi, hve_hvy, hvq_2_5,
         algorithmic_score, discretionary_score, total_score, max_possible_score,
         override_count, score_breakdown_json, data_freshness, reviewed_at
       ) VALUES (
         ?, ?, ?, ?, ?,
         ?, ?, ?, ?,
         ?, ?, ?, ?,
         ?, ?, ?, ?, ?,
         ?, ?, ?, ?,
         ?, ?, ?, ?
       )`,
      [
        data.symbol,
        data.token,
        data.name,
        data.scoringSessionId,
        data.status,
        data.epCatalyst ?? null,
        data.sectorStrength ?? null,
        data.highRs ?? null,
        data.ipoRecency ?? null,
        data.thrustPower ?? null,
        data.pivotLocation ?? null,
        data.patternQuality ?? null,
        data.pivotLevelProximity ?? null,
        data.linearity ?? null,
        data.notPivotCutter ?? null,
        data.aoi ?? null,
        data.hveHvy ?? null,
        data.hvq2_5 ?? null,
        data.breakdown.algorithmicScore,
        data.breakdown.discretionaryScore,
        data.breakdown.totalScore,
        data.breakdown.maxPossibleScore,
        data.overrideCount,
        JSON.stringify(data.breakdown),
        data.dataFreshness,
        data.reviewedAt ?? null,
      ]
    );
    const row = this.db.queryOne<{ id: number }>(
      'SELECT last_insert_rowid() AS id'
    );
    return row!.id;
  }

  getStockScore(symbol: string, sessionId: string): StockScore | null {
    const row = this.db.queryOne<StockScoreRow>(
      `SELECT * FROM stock_scores
       WHERE symbol = ? AND scoring_session_id = ?
       ORDER BY updated_at DESC LIMIT 1`,
      [symbol, sessionId]
    );
    return row ? rowToStockScore(row) : null;
  }

  updateStockScoreStatus(id: number, status: string): void {
    this.db.execute(
      `UPDATE stock_scores SET status = ?, updated_at = datetime('now') WHERE id = ?`,
      [status, id]
    );
  }

  // --- MBI Daily ---

  upsertMBIDaily(data: UpsertMBIData): void {
    this.db.execute(
      `INSERT INTO mbi_daily (
         date, captured_at, source, em,
         pct_52wh, pct_52wl, ratio_4_5,
         pct_above_20sma, pct_above_50sma, pct_above_200sma, pct_below_200sma,
         f10, f20, f50, raw_source_json, data_freshness
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(date, captured_at) DO UPDATE SET
         source = excluded.source,
         em = excluded.em,
         pct_52wh = excluded.pct_52wh,
         pct_52wl = excluded.pct_52wl,
         ratio_4_5 = excluded.ratio_4_5,
         pct_above_20sma = excluded.pct_above_20sma,
         pct_above_50sma = excluded.pct_above_50sma,
         pct_above_200sma = excluded.pct_above_200sma,
         pct_below_200sma = excluded.pct_below_200sma,
         f10 = excluded.f10,
         f20 = excluded.f20,
         f50 = excluded.f50,
         raw_source_json = excluded.raw_source_json,
         data_freshness = excluded.data_freshness,
         fetched_at = datetime('now')`,
      [
        data.date,
        data.capturedAt,
        data.source,
        data.em ?? null,
        data.pct52WH ?? null,
        data.pct52WL ?? null,
        data.ratio4_5 ?? null,
        data.pctAbove20SMA ?? null,
        data.pctAbove50SMA ?? null,
        data.pctAbove200SMA ?? null,
        data.pctBelow200SMA ?? null,
        data.f10 ?? null,
        data.f20 ?? null,
        data.f50 ?? null,
        data.rawSourceJson ?? null,
        data.dataFreshness,
      ]
    );
  }

  getLatestMBI(): MBIData | null {
    const row = this.db.queryOne<MBIDailyRow>(
      `SELECT * FROM mbi_daily ORDER BY date DESC, fetched_at DESC LIMIT 1`
    );
    return row ? rowToMBIData(row) : null;
  }

  /** Alias for getLatestMBI — used by stale_cache fallback. */
  getLatestMBIDaily(): MBIData | null {
    return this.getLatestMBI();
  }

  /**
   * Get MBI history for the last N days, ordered by date ascending.
   */
  getMBIHistory(days: number): MBIData[] {
    const rows = this.db.query<MBIDailyRow>(
      `SELECT * FROM mbi_daily ORDER BY date DESC LIMIT ?`,
      [days],
    );
    // Reverse to ascending order
    return rows.reverse().map(rowToMBIData);
  }

  // --- Market Context ---

  upsertMarketContext(ctx: MarketContext): void {
    this.db.execute(
      `INSERT INTO market_context (date, nifty_close, nifty_50dma, nifty_200dma, mbi_regime, mbi_em, mbi_source)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(date) DO UPDATE SET
         nifty_close = excluded.nifty_close,
         nifty_50dma = excluded.nifty_50dma,
         nifty_200dma = excluded.nifty_200dma,
         mbi_regime = excluded.mbi_regime,
         mbi_em = excluded.mbi_em,
         mbi_source = excluded.mbi_source`,
      [
        ctx.date,
        ctx.niftyClose,
        ctx.nifty50DMA,
        ctx.nifty200DMA,
        ctx.mbiRegime ?? null,
        ctx.mbiEm ?? null,
        ctx.mbiSource ?? null,
      ],
    );
  }

  getMarketContextForDate(date: string): MarketContext | null {
    const row = this.db.queryOne<MarketContextRow>(
      `SELECT * FROM market_context WHERE date = ?`,
      [date],
    );
    return row ? rowToMarketContext(row) : null;
  }

  getLatestMarketContext(): MarketContext | null {
    const row = this.db.queryOne<MarketContextRow>(
      `SELECT * FROM market_context ORDER BY date DESC LIMIT 1`,
    );
    return row ? rowToMarketContext(row) : null;
  }

  // --- API Usage ---

  upsertApiUsage(date: string, service: string, count: number): void {
    this.db.execute(
      `INSERT INTO api_usage (date, service, call_count) VALUES (?, ?, ?)
       ON CONFLICT(date, service) DO UPDATE SET
         call_count = call_count + excluded.call_count`,
      [date, service, count]
    );
  }

  getApiUsage(date: string): Record<string, number> {
    const rows = this.db.query<ApiUsageRow>(
      `SELECT service, call_count FROM api_usage WHERE date = ?`,
      [date]
    );
    const result: Record<string, number> = {};
    for (const row of rows) {
      result[row.service] = row.call_count;
    }
    return result;
  }

  // --- Trade Journal ---

  insertTradeEntry(data: InsertTradeData): number {
    this.db.execute(
      `INSERT INTO trade_journal (
         symbol, trade_type, entry_date, entry_price, shares,
         stop_price, risk_amount, score_at_entry, score_breakdown_json,
         market_regime_at_entry, sector_at_entry, conviction, override_count
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.symbol,
        data.tradeType,
        data.entryDate,
        data.entryPrice,
        data.shares,
        data.stopPrice ?? null,
        data.riskAmount ?? null,
        data.scoreAtEntry ?? null,
        data.scoreBreakdownJson ?? null,
        data.marketRegimeAtEntry ?? null,
        data.sectorAtEntry ?? null,
        data.conviction ?? null,
        data.overrideCount ?? 0,
      ]
    );
    const row = this.db.queryOne<{ id: number }>(
      'SELECT last_insert_rowid() AS id'
    );
    return row!.id;
  }

  closeTradeEntry(id: number, exitData: CloseTradeData): void {
    this.db.execute(
      `UPDATE trade_journal SET
         exit_date = ?,
         exit_price = ?,
         exit_reason = ?,
         pnl = ?,
         r_multiple = ?,
         hold_days = ?,
         status = 'CLOSED'
       WHERE id = ?`,
      [
        exitData.exitDate,
        exitData.exitPrice,
        exitData.exitReason,
        exitData.pnl,
        exitData.rMultiple,
        exitData.holdDays,
        id,
      ]
    );
  }

  getTradeById(id: number): TradeJournalEntry | null {
    const row = this.db.queryOne<TradeJournalRow>(
      `SELECT * FROM trade_journal WHERE id = ?`,
      [id]
    );
    return row ? rowToTradeJournal(row) : null;
  }

  getOpenTrades(): TradeJournalEntry[] {
    const rows = this.db.query<TradeJournalRow>(
      `SELECT * FROM trade_journal WHERE status = 'OPEN' ORDER BY entry_date ASC`
    );
    return rows.map(rowToTradeJournal);
  }

  getClosedTrades(): TradeJournalEntry[] {
    const rows = this.db.query<TradeJournalRow>(
      `SELECT * FROM trade_journal WHERE status = 'CLOSED' ORDER BY exit_date DESC`
    );
    return rows.map(rowToTradeJournal);
  }

  getAllTrades(): TradeJournalEntry[] {
    const rows = this.db.query<TradeJournalRow>(
      `SELECT * FROM trade_journal ORDER BY entry_date DESC`
    );
    return rows.map(rowToTradeJournal);
  }

  getOpenTradeForSymbol(symbol: string): TradeJournalEntry | null {
    const row = this.db.queryOne<TradeJournalRow>(
      `SELECT * FROM trade_journal WHERE symbol = ? AND status = 'OPEN' LIMIT 1`,
      [symbol]
    );
    return row ? rowToTradeJournal(row) : null;
  }

  /**
   * Get average total scores per day, ordered by date ascending.
   * Groups by created_at date and averages total_score across all stocks scored that day.
   */
  getDailyAverageScores(days: number): Array<{ date: string; avgScore: number; count: number }> {
    const rows = this.db.query<{ date: string; avg_score: number; cnt: number }>(
      `SELECT DATE(created_at) AS date, AVG(total_score) AS avg_score, COUNT(*) AS cnt
       FROM stock_scores
       GROUP BY DATE(created_at)
       ORDER BY date DESC
       LIMIT ?`,
      [days],
    );
    return rows.reverse().map((r) => ({
      date: r.date,
      avgScore: r.avg_score,
      count: r.cnt,
    }));
  }

  getLatestScoreForSymbol(symbol: string): StockScore | null {
    const row = this.db.queryOne<StockScoreRow>(
      `SELECT * FROM stock_scores WHERE symbol = ? ORDER BY updated_at DESC LIMIT 1`,
      [symbol]
    );
    return row ? rowToStockScore(row) : null;
  }

  // --- Positions ---

  getOpenPositions(): Position[] {
    const rows = this.db.query<PositionRow>(
      `SELECT * FROM positions WHERE status = 'OPEN' ORDER BY entry_date ASC`
    );
    return rows.map(rowToPosition);
  }

  // --- Settings ---

  upsertSetting(key: string, value: string): void {
    this.db.execute(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
      [key, value]
    );
  }

  getSetting(key: string): string | null {
    const row = this.db.queryOne<{ value: string }>(
      `SELECT value FROM settings WHERE key = ?`,
      [key]
    );
    return row?.value ?? null;
  }

  // --- Chat Sessions ---

  insertChatMessage(chatId: string, platform: string, role: 'user' | 'assistant', message: string): void {
    this.db.execute(
      `INSERT INTO chat_sessions (chat_id, platform, role, message) VALUES (?, ?, ?, ?)`,
      [chatId, platform, role, message],
    );
  }

  getRecentChatMessages(chatId: string, limit: number = 10): Array<{ role: string; message: string; createdAt: string }> {
    const rows = this.db.query<{ role: string; message: string; created_at: string }>(
      `SELECT role, message, created_at FROM chat_sessions
       WHERE chat_id = ? ORDER BY created_at DESC, id DESC LIMIT ?`,
      [chatId, limit],
    );
    return rows.reverse().map((r) => ({ role: r.role, message: r.message, createdAt: r.created_at }));
  }

  trimChatHistory(chatId: string, keepLast: number): void {
    this.db.execute(
      `DELETE FROM chat_sessions WHERE chat_id = ? AND id NOT IN (
        SELECT id FROM chat_sessions WHERE chat_id = ? ORDER BY created_at DESC, id DESC LIMIT ?
      )`,
      [chatId, chatId, keepLast],
    );
  }

  // --- Automation Log ---

  insertAutomationLog(action: string, status: 'success' | 'failure' | 'skipped', details?: string, triggeredBy?: string): void {
    this.db.execute(
      `INSERT INTO automation_log (action, status, details, triggered_by) VALUES (?, ?, ?, ?)`,
      [action, status, details ?? null, triggeredBy ?? 'scheduler'],
    );
  }

  getAutomationLogs(limit: number = 50): Array<{ action: string; status: string; details: string | null; triggeredBy: string; createdAt: string }> {
    const rows = this.db.query<{ action: string; status: string; details: string | null; triggered_by: string; created_at: string }>(
      `SELECT action, status, details, triggered_by, created_at FROM automation_log
       ORDER BY created_at DESC LIMIT ?`,
      [limit],
    );
    return rows.map((r) => ({ action: r.action, status: r.status, details: r.details, triggeredBy: r.triggered_by, createdAt: r.created_at }));
  }
}
