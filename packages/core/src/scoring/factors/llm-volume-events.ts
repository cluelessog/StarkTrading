import type { FactorInput, FactorOutput } from '../registry.js';
import { computeATR, findBase } from './pivot-location.js';

/**
 * HVE / HVY: Volume events within a consolidation base (≤2 months).
 *
 * Benchmarks (computed from full history):
 *   HVQ = highest single-day volume in last ~63 trading days (1 quarter)
 *   HVY = highest single-day volume in last ~252 trading days (1 year)
 *   HVE = highest single-day volume in all available history
 *
 * Scoring (graduated, maxPoints: 1):
 *   Both HVE and HVY present in base → 1.0
 *   HVE present → 1.0
 *   HVY present → 0.5
 *   Neither → 0
 */
export async function volumeEvents(input: FactorInput): Promise<FactorOutput> {
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

  // Scan bars within the base for volume events
  const baseBars = searchBars.slice(base.startIdx, base.endIdx + 1);
  let hasHVE = false;
  let hasHVY = false;

  for (const bar of baseBars) {
    if (bar.volume >= hve) hasHVE = true;
    if (bar.volume >= hvy) hasHVY = true;
  }

  let score: number;
  let label: string;
  if (hasHVE) {
    score = 1.0;
    label = hasHVY ? 'HVE + HVY present in base' : 'HVE present in base';
  } else if (hasHVY) {
    score = 0.5;
    label = 'HVY present in base (no HVE)';
  } else {
    score = 0;
    label = 'No HVE or HVY volume events in base';
  }

  return {
    score,
    reasoning: `${label}. Base: ${base.length} days. HVE=${hve.toLocaleString()}, HVY=${hvy.toLocaleString()}, HVQ=${hvq.toLocaleString()}`,
    dataSource: 'ohlcv_cache',
    metadata: { hve, hvy, hvq, hasHVE, hasHVY, baseLength: base.length },
  };
}
