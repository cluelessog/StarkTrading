import type { FactorInput, FactorOutput } from '../registry.js';

/**
 * Pivot Level Proximity: current price within 3% of the detected pivot.
 * Pivot = highest high in the consolidation base (or recent 20-bar channel high).
 */
export async function pivotLevelProximity(input: FactorInput): Promise<FactorOutput> {
  const { dailyBars } = input;

  if (dailyBars.length < 20) {
    return {
      score: 0,
      reasoning: 'Insufficient data for pivot detection (need 20+ bars)',
      dataSource: 'ohlcv_cache',
    };
  }

  // Detect pivot: highest high in last 20-60 bars (consolidation high)
  const lookback = Math.min(dailyBars.length, 60);
  const recentBars = dailyBars.slice(-lookback);

  const pivotPrice = Math.max(...recentBars.map((b) => b.high));
  const currentPrice = dailyBars[dailyBars.length - 1].close;

  if (pivotPrice <= 0) {
    return {
      score: 0,
      reasoning: 'Invalid price data',
      dataSource: 'ohlcv_cache',
    };
  }

  const distancePct = Math.abs((currentPrice - pivotPrice) / pivotPrice) * 100;

  if (distancePct <= 3) {
    return {
      score: 1,
      reasoning: `Price ${currentPrice.toFixed(2)} is ${distancePct.toFixed(1)}% from pivot ${pivotPrice.toFixed(2)} (within 3%)`,
      dataSource: 'ohlcv_cache',
      metadata: { currentPrice, pivotPrice, distancePct },
    };
  }

  return {
    score: 0,
    reasoning: `Price ${currentPrice.toFixed(2)} is ${distancePct.toFixed(1)}% from pivot ${pivotPrice.toFixed(2)} (need ≤3%)`,
    dataSource: 'ohlcv_cache',
    metadata: { currentPrice, pivotPrice, distancePct },
  };
}
