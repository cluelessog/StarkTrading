import type { MBIRegime, MBIData, EMThresholds } from '../models/market.js';

const DEFAULT_THRESHOLDS: EMThresholds = {
  strongBull: 25,
  bull: 15,
  cautious: 12,
  choppy: 9.5,
};

/**
 * 5-tier regime classification based on EM (Effective Measure).
 * STRONG_BULL: EM > 25
 * BULL: EM > 15
 * CAUTIOUS: EM 12-15
 * CHOPPY: EM 9.5-12
 * BEAR: EM < 9.5
 */
export function classifyRegime(
  em: number | null | undefined,
  thresholds: EMThresholds = DEFAULT_THRESHOLDS,
): MBIRegime {
  if (em == null) return 'CAUTIOUS'; // conservative default when EM unknown

  if (em >= thresholds.strongBull) return 'STRONG_BULL';
  if (em >= thresholds.bull) return 'BULL';
  if (em >= thresholds.cautious) return 'CAUTIOUS';
  if (em >= thresholds.choppy) return 'CHOPPY';
  return 'BEAR';
}

/**
 * Breadth-only fallback classifier (no EM available).
 * Uses 52WH%, 52WL%, SMA% for coarse regime without EM.
 * Cannot produce STRONG_BULL (conservative bias).
 */
export function classifyFromBreadth(mbi: MBIData): MBIRegime {
  const pct52WH = mbi.pct52WH ?? 0;
  const pct52WL = mbi.pct52WL ?? 0;
  const pctAbove200SMA = mbi.pctAbove200SMA ?? 50;

  // High 52WH with low 52WL and strong SMA → BULL
  if (pct52WH > 20 && pct52WL < 10 && pctAbove200SMA > 60) return 'BULL';

  // Low 52WH with high 52WL → BEAR
  if (pct52WH < 5 && pct52WL > 20) return 'BEAR';
  if (pctAbove200SMA < 40) return 'BEAR';

  // Moderate breadth → CAUTIOUS or CHOPPY
  if (pctAbove200SMA > 50 && pct52WH > 10) return 'CAUTIOUS';

  return 'CHOPPY';
}
