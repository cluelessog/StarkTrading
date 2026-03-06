import type { FactorInput, FactorOutput } from '../registry.js';

/**
 * Sector Strength: stock's sector index outperforming Nifty 50.
 * Compares recent % change of stock vs Nifty.
 * In v1, uses the stock's own performance as a proxy (sector index data
 * requires NSE API integration, deferred to when that client is built).
 */
export async function sectorStrength(input: FactorInput): Promise<FactorOutput> {
  const { dailyBars } = input;

  if (dailyBars.length < 20) {
    return {
      score: 0,
      reasoning: 'Insufficient data for sector comparison (need 20+ bars)',
      dataSource: 'ohlcv_cache',
    };
  }

  // Compare 20-day performance: stock change vs 0 (placeholder for Nifty)
  // In production, this would compare sector index vs Nifty 50
  const recent = dailyBars.slice(-20);
  const startPrice = recent[0].close;
  const endPrice = recent[recent.length - 1].close;

  if (startPrice <= 0) {
    return {
      score: 0,
      reasoning: 'Invalid price data',
      dataSource: 'ohlcv_cache',
    };
  }

  const changePct = ((endPrice - startPrice) / startPrice) * 100;

  // Positive 20-day change indicates sector strength (simplified)
  if (changePct > 0) {
    return {
      score: 1,
      reasoning: `Stock up ${changePct.toFixed(1)}% in 20 days (sector proxy: positive)`,
      dataSource: 'ohlcv_cache',
      metadata: { changePct, period: 20 },
    };
  }

  return {
    score: 0,
    reasoning: `Stock down ${changePct.toFixed(1)}% in 20 days`,
    dataSource: 'ohlcv_cache',
    metadata: { changePct, period: 20 },
  };
}
