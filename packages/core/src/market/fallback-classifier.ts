import type { BreadthData, MBIRegime } from '../models/market.js';

export interface FallbackClassification {
  regime: MBIRegime;
  confidence: 'breadth_only';
  reason: string;
}

/**
 * Breadth-only regime classification with detailed reasoning.
 * Never returns STRONG_BULL (conservative bias).
 *
 * Thresholds:
 * - highLowHealthy: 52WH > 20%, 52WL < 10%
 * - highLowStrong: 52WH > 10%, 52WL < 5%
 * - highLowWeak: 52WH < 5%, 52WL > 20%
 * - broadBullish: >200SMA > 60%
 * - broadBearish: >200SMA < 40%
 */
export function classifyFromBreadthDetailed(data: BreadthData): FallbackClassification {
  const pct52WH = data.pct52WH ?? 0;
  const pct52WL = data.pct52WL ?? 0;
  const pctAbove200SMA = data.pctAbove200SMA ?? 50;
  const pctAbove50SMA = data.pctAbove50SMA ?? 50;

  // BULL: healthy high/low spread + strong SMA breadth
  if (pct52WH > 20 && pct52WL < 10 && pctAbove200SMA > 60) {
    return {
      regime: 'BULL',
      confidence: 'breadth_only',
      reason: `Strong breadth: 52WH ${pct52WH.toFixed(1)}% > 20%, 52WL ${pct52WL.toFixed(1)}% < 10%, >200SMA ${pctAbove200SMA.toFixed(1)}% > 60%`,
    };
  }

  // BEAR: weak high/low + poor SMA
  if (pct52WH < 5 && pct52WL > 20) {
    return {
      regime: 'BEAR',
      confidence: 'breadth_only',
      reason: `Weak breadth: 52WH ${pct52WH.toFixed(1)}% < 5%, 52WL ${pct52WL.toFixed(1)}% > 20%`,
    };
  }

  if (pctAbove200SMA < 40) {
    return {
      regime: 'BEAR',
      confidence: 'breadth_only',
      reason: `Broad weakness: >200SMA ${pctAbove200SMA.toFixed(1)}% < 40%`,
    };
  }

  // CAUTIOUS: moderate breadth with some positive signals
  if (pctAbove200SMA > 50 && pct52WH > 10) {
    return {
      regime: 'CAUTIOUS',
      confidence: 'breadth_only',
      reason: `Moderate breadth: >200SMA ${pctAbove200SMA.toFixed(1)}% > 50%, 52WH ${pct52WH.toFixed(1)}% > 10%`,
    };
  }

  // CHOPPY: everything else
  return {
    regime: 'CHOPPY',
    confidence: 'breadth_only',
    reason: `Mixed signals: 52WH ${pct52WH.toFixed(1)}%, 52WL ${pct52WL.toFixed(1)}%, >200SMA ${pctAbove200SMA.toFixed(1)}%, >50SMA ${pctAbove50SMA.toFixed(1)}%`,
  };
}
