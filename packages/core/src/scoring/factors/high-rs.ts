import type { FactorInput, FactorOutput } from '../registry.js';

/**
 * High Relative Strength: stock % change vs Nifty % change over 60 days.
 * Threshold: stock must outperform Nifty by >15%.
 * In v1, compares stock's 60-day return against 0% (Nifty data via
 * separate OHLCV fetch is deferred to NSE API integration).
 */
export async function highRS(input: FactorInput): Promise<FactorOutput> {
  const { dailyBars } = input;

  if (dailyBars.length < 60) {
    return {
      score: 0,
      reasoning: `Insufficient data: ${dailyBars.length} bars (need 60)`,
      dataSource: 'ohlcv_cache',
    };
  }

  const bars60 = dailyBars.slice(-60);
  const startPrice = bars60[0].close;
  const endPrice = bars60[bars60.length - 1].close;

  if (startPrice <= 0) {
    return {
      score: 0,
      reasoning: 'Invalid price data',
      dataSource: 'ohlcv_cache',
    };
  }

  const stockChange = ((endPrice - startPrice) / startPrice) * 100;

  // RS = stock change - nifty change. With nifty placeholder = 0:
  const rsExcess = stockChange; // Will subtract Nifty change when available

  if (rsExcess > 15) {
    return {
      score: 1,
      reasoning: `RS excess: +${rsExcess.toFixed(1)}% over 60 days (threshold: >15%)`,
      dataSource: 'ohlcv_cache',
      metadata: { stockChange, rsExcess, period: 60 },
    };
  }

  return {
    score: 0,
    reasoning: `RS excess: ${rsExcess.toFixed(1)}% (need >15%)`,
    dataSource: 'ohlcv_cache',
    metadata: { stockChange, rsExcess, period: 60 },
  };
}
