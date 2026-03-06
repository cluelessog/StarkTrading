import type { FactorInput, FactorOutput } from '../registry.js';

/**
 * Thrust Power: max candle range ≥8% in last 60 days.
 * Binary: 0 or 1. Candle range = (high - low) / low × 100.
 */
export async function thrustPower(input: FactorInput): Promise<FactorOutput> {
  const { dailyBars } = input;

  if (dailyBars.length < 10) {
    return {
      score: 0,
      reasoning: 'Insufficient data for thrust power check',
      dataSource: 'ohlcv_cache',
    };
  }

  const bars60 = dailyBars.slice(-60);
  let maxRange = 0;
  let maxRangeDate = '';

  for (const bar of bars60) {
    if (bar.low <= 0) continue;
    const range = ((bar.high - bar.low) / bar.low) * 100;
    if (range > maxRange) {
      maxRange = range;
      maxRangeDate = bar.timestamp;
    }
  }

  if (maxRange >= 8) {
    return {
      score: 1,
      reasoning: `Max candle range: ${maxRange.toFixed(1)}% on ${maxRangeDate} (threshold: ≥8%)`,
      dataSource: 'ohlcv_cache',
      metadata: { maxRange, maxRangeDate },
    };
  }

  return {
    score: 0,
    reasoning: `Max candle range: ${maxRange.toFixed(1)}% (need ≥8%)`,
    dataSource: 'ohlcv_cache',
    metadata: { maxRange },
  };
}
