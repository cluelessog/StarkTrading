import type { FactorInput, FactorOutput } from '../registry.js';
import { computeATR, findBase } from './pivot-location.js';

/**
 * 2.5 HVQ: Aggregated volume quality within a consolidation base (≤2 months).
 *
 * Each bar in the base contributes HVQ-equivalents based on its volume level:
 *   HVE level → 2.0 HVQ-equivalents
 *   HVY level → 1.5 HVQ-equivalents
 *   HVQ level → 1.0 HVQ-equivalents
 *
 * Score 1 (maxPoints) if aggregate ≥ 2.5, else 0.
 */
export async function volumeQuality(input: FactorInput): Promise<FactorOutput> {
  const { dailyBars } = input;

  if (dailyBars.length < 63) {
    return {
      score: 0,
      reasoning: 'Insufficient data for volume benchmarks (need 63+ bars)',
      dataSource: 'ohlcv_cache',
    };
  }

  // Detect base (≤42 trading days ≈ 2 months)
  const atrs = computeATR(dailyBars, 10);
  const lookback = Math.min(dailyBars.length, 120);
  const searchBars = dailyBars.slice(-lookback);
  const searchATRs = atrs.slice(-lookback);
  const base = findBase(searchBars, searchATRs, 42);

  if (!base) {
    return {
      score: 0,
      reasoning: 'No valid consolidation base (≤2 months) detected',
      dataSource: 'ohlcv_cache',
    };
  }

  // Compute volume benchmarks from full history
  const allVolumes = dailyBars.map((b) => b.volume);
  const hve = Math.max(...allVolumes);
  const hvyBars = dailyBars.slice(-252);
  const hvy = Math.max(...hvyBars.map((b) => b.volume));
  const hvqBars = dailyBars.slice(-63);
  const hvq = Math.max(...hvqBars.map((b) => b.volume));

  // Aggregate weighted HVQ-equivalents across all bars in base
  const baseBars = searchBars.slice(base.startIdx, base.endIdx + 1);
  let aggregate = 0;

  for (const bar of baseBars) {
    if (bar.volume >= hve) {
      aggregate += 2.0;
    } else if (bar.volume >= hvy) {
      aggregate += 1.5;
    } else if (bar.volume >= hvq) {
      aggregate += 1.0;
    }
  }

  const score = aggregate >= 2.5 ? 1 : 0;

  return {
    score,
    reasoning: `Aggregate HVQ-equivalents: ${aggregate.toFixed(1)} (threshold: 2.5). Base: ${base.length} days`,
    dataSource: 'ohlcv_cache',
    metadata: { aggregate, hve, hvy, hvq, baseLength: base.length },
  };
}
