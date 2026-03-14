import type { DataProvider } from '../api/data-provider.js';
import type { DatabaseAdapter } from '../db/adapter.js';
import type { OHLCVBar } from '../models/intervals.js';
import { Queries } from '../db/queries.js';
import type { ConstituentInfo } from './nifty-constituents.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BreadthCalculatorConfig {
  universe: 'NIFTY50' | 'NIFTY500';
  nifty50Constituents: ConstituentInfo[];
  nifty500Constituents?: ConstituentInfo[];
}

export interface BreadthResult {
  pct52WH: number;
  pct52WL: number;
  pctAbove20SMA: number;
  pctAbove50SMA: number;
  pctAbove200SMA: number;
  pctBelow200SMA: number;
  ratio4_5: number;
  f10: number;
  f20: number;
  f50: number;
  totalStocks: number;
  successfulStocks: number;
  failedStocks: string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TRADING_DAYS_52W = 252;
const OHLCV_FETCH_DAYS = 260; // 52W + buffer
const WARMUP_DAYS = 200;
const WARMUP_COVERAGE = 0.8; // 80% of constituents need history

// ---------------------------------------------------------------------------
// BreadthCalculator
// ---------------------------------------------------------------------------

export class BreadthCalculator {
  private queries: Queries;

  constructor(
    private provider: DataProvider,
    private db: DatabaseAdapter,
    private config: BreadthCalculatorConfig,
  ) {
    this.queries = new Queries(db);
  }

  /**
   * Returns true when >= 200 days of OHLCV history exists
   * for at least 80% of NIFTY 50 constituents.
   */
  isWarm(): boolean {
    const constituents = this.config.nifty50Constituents;
    const threshold = Math.ceil(constituents.length * WARMUP_COVERAGE);
    let warmCount = 0;

    const to = new Date().toISOString().slice(0, 10);
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - OHLCV_FETCH_DAYS);
    const from = fromDate.toISOString().slice(0, 10);

    for (const c of constituents) {
      const bars = this.queries.getOHLCV(c.symbol, '1d', from, to);
      if (bars.length >= WARMUP_DAYS) {
        warmCount++;
      }
    }

    return warmCount >= threshold;
  }

  /**
   * Calculate breadth indicators from OHLCV data for the configured universe.
   * Fetches data for each constituent, computes SMA/52WH/52WL/AD metrics.
   * Stocks that fail to fetch are excluded from the calculation.
   */
  async calculateBreadth(): Promise<BreadthResult> {
    const constituents = this.config.nifty50Constituents;
    const allBars = new Map<string, OHLCVBar[]>();
    const failedStocks: string[] = [];

    // Fetch OHLCV for each constituent
    for (const c of constituents) {
      try {
        const bars = await this.fetchStockOHLCV(c.symbol, c.token);
        if (bars.length > 0) {
          allBars.set(c.symbol, bars);
        } else {
          failedStocks.push(c.symbol);
        }
      } catch {
        failedStocks.push(c.symbol);
      }
    }

    const successfulStocks = allBars.size;
    if (successfulStocks === 0) {
      return {
        pct52WH: 0,
        pct52WL: 0,
        pctAbove20SMA: 0,
        pctAbove50SMA: 0,
        pctAbove200SMA: 0,
        pctBelow200SMA: 100,
        ratio4_5: 0,
        f10: 50,
        f20: 50,
        f50: 50,
        totalStocks: constituents.length,
        successfulStocks: 0,
        failedStocks: failedStocks,
      };
    }

    // Count indicators
    let count52WH = 0;
    let count52WL = 0;
    let countAbove20SMA = 0;
    let countAbove50SMA = 0;
    let countAbove200SMA = 0;

    for (const [, bars] of allBars) {
      if (this.is52WeekHigh(bars)) count52WH++;
      if (this.is52WeekLow(bars)) count52WL++;

      const lastClose = bars[bars.length - 1].close;

      const sma20 = this.calculateSMA(bars, 20);
      if (sma20 !== null && lastClose > sma20) countAbove20SMA++;

      const sma50 = this.calculateSMA(bars, 50);
      if (sma50 !== null && lastClose > sma50) countAbove50SMA++;

      const sma200 = this.calculateSMA(bars, 200);
      if (sma200 !== null && lastClose > sma200) countAbove200SMA++;
    }

    const pct52WH = (count52WH / successfulStocks) * 100;
    const pct52WL = (count52WL / successfulStocks) * 100;
    const pctAbove20SMA = (countAbove20SMA / successfulStocks) * 100;
    const pctAbove50SMA = (countAbove50SMA / successfulStocks) * 100;
    const pctAbove200SMA = (countAbove200SMA / successfulStocks) * 100;
    const pctBelow200SMA = 100 - pctAbove200SMA;

    // Advance/Decline at 4.5% threshold
    const ratio4_5 = this.calculateAdvanceDecline(allBars, 4.5);

    // Oscillators: simplified as current pctAbove scaled 0-100
    // (Real oscillator needs historical pctAbove series; approximate from current data)
    const f10 = this.calculateOscillator(pctAbove20SMA, [], 10);
    const f20 = this.calculateOscillator(pctAbove50SMA, [], 20);
    const f50 = this.calculateOscillator(pctAbove200SMA, [], 50);

    return {
      pct52WH,
      pct52WL,
      pctAbove20SMA,
      pctAbove50SMA,
      pctAbove200SMA,
      pctBelow200SMA,
      ratio4_5,
      f10,
      f20,
      f50,
      totalStocks: constituents.length,
      successfulStocks,
      failedStocks,
    };
  }

  /**
   * Fetch OHLCV data for a stock. Uses cache first, then provider.
   */
  private async fetchStockOHLCV(symbol: string, token: string): Promise<OHLCVBar[]> {
    const to = new Date().toISOString().slice(0, 10);
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - OHLCV_FETCH_DAYS);
    const from = fromDate.toISOString().slice(0, 10);

    // Check cache
    const cached = this.queries.getOHLCV(symbol, '1d', from, to);
    if (cached.length >= WARMUP_DAYS) {
      return cached;
    }

    // Fetch from provider
    const bars = await this.provider.fetchOHLCV(symbol, token, '1d', from, to);

    // Cache the results
    for (const bar of bars) {
      this.queries.upsertOHLCV({
        symbol,
        interval: '1d',
        date: bar.timestamp,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume,
      });
    }

    return bars;
  }

  /**
   * Calculate Simple Moving Average over the last `period` bars.
   */
  calculateSMA(bars: OHLCVBar[], period: number): number | null {
    if (bars.length < period) return null;
    const slice = bars.slice(-period);
    const sum = slice.reduce((acc, b) => acc + b.close, 0);
    return sum / period;
  }

  /**
   * Check if latest close is at or above 52-week high.
   */
  is52WeekHigh(bars: OHLCVBar[]): boolean {
    if (bars.length < 2) return false;
    const lookback = bars.slice(-TRADING_DAYS_52W);
    const lastClose = bars[bars.length - 1].close;
    const maxClose = Math.max(...lookback.map((b) => b.close));
    return lastClose >= maxClose;
  }

  /**
   * Check if latest close is at or below 52-week low.
   */
  is52WeekLow(bars: OHLCVBar[]): boolean {
    if (bars.length < 2) return false;
    const lookback = bars.slice(-TRADING_DAYS_52W);
    const lastClose = bars[bars.length - 1].close;
    const minClose = Math.min(...lookback.map((b) => b.close));
    return lastClose <= minClose;
  }

  /**
   * Calculate advance/decline ratio at a given percentage threshold.
   * Ratio = count(change > threshold%) / count(change < -threshold%)
   * Uses the latest day's change for each stock.
   */
  private calculateAdvanceDecline(
    allBars: Map<string, OHLCVBar[]>,
    threshold: number,
  ): number {
    let advances = 0;
    let declines = 0;

    for (const [, bars] of allBars) {
      if (bars.length < 2) continue;
      const prevClose = bars[bars.length - 2].close;
      const currClose = bars[bars.length - 1].close;
      if (prevClose === 0) continue;

      const changePct = ((currClose - prevClose) / prevClose) * 100;

      if (changePct > threshold) advances++;
      if (changePct < -threshold) declines++;
    }

    if (declines === 0) return advances > 0 ? 999 : 0;
    return Math.round((advances / declines) * 100) / 100;
  }

  /**
   * Calculate breadth oscillator.
   * Without historical pctAbove series, returns current pct directly (0-100).
   * When historical data is available, computes rate of change scaled to 0-100.
   */
  private calculateOscillator(
    currentPct: number,
    historicalPcts: number[],
    _period: number,
  ): number {
    if (historicalPcts.length === 0) {
      // Without history, return current percentage as-is (already 0-100)
      return Math.round(currentPct * 100) / 100;
    }

    // Rate of change: (current - oldest) / oldest, scaled to 0-100
    const oldest = historicalPcts[0];
    if (oldest === 0) return 50;
    const roc = ((currentPct - oldest) / oldest) * 100;
    // Clamp to 0-100 range
    return Math.max(0, Math.min(100, 50 + roc / 2));
  }
}
