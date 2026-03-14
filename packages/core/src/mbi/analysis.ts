import type { MBIData } from '../models/market.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CorrelationResult {
  pearsonR: number;
  sampleSize: number;
  interpretation: string;
}

export interface RegimeTransition {
  date: string;
  from: string;
  to: string;
}

// ---------------------------------------------------------------------------
// Pearson Correlation
// ---------------------------------------------------------------------------

/**
 * Calculate Pearson correlation coefficient between two arrays.
 * Returns 0 if arrays are empty or have zero variance.
 */
export function calculatePearsonCorrelation(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length);
  if (n < 2) return 0;

  const xs = x.slice(0, n);
  const ys = y.slice(0, n);

  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;

  let sumXY = 0;
  let sumX2 = 0;
  let sumY2 = 0;

  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    sumXY += dx * dy;
    sumX2 += dx * dx;
    sumY2 += dy * dy;
  }

  const denom = Math.sqrt(sumX2 * sumY2);
  if (denom === 0) return 0;

  return sumXY / denom;
}

// ---------------------------------------------------------------------------
// Interpretation
// ---------------------------------------------------------------------------

function interpretCorrelation(r: number, n: number): string {
  if (n < 5) return 'Insufficient data for meaningful interpretation';

  const absR = Math.abs(r);
  let strength: string;

  if (absR >= 0.7) strength = 'strong';
  else if (absR >= 0.4) strength = 'moderate';
  else if (absR >= 0.2) strength = 'weak';
  else return 'No meaningful correlation detected';

  const direction = r > 0 ? 'positive' : 'negative';
  return `${strength} ${direction} correlation (r=${r.toFixed(3)}, n=${n})`;
}

// ---------------------------------------------------------------------------
// MBI-Score Correlation Analysis
// ---------------------------------------------------------------------------

/**
 * Analyze correlation between daily EM values and average scores.
 * Takes MBI history and corresponding average score values.
 */
export function analyzeMBIScoreCorrelation(
  emValues: number[],
  avgScores: number[],
): CorrelationResult {
  const n = Math.min(emValues.length, avgScores.length);
  const pearsonR = calculatePearsonCorrelation(emValues, avgScores);

  return {
    pearsonR,
    sampleSize: n,
    interpretation: interpretCorrelation(pearsonR, n),
  };
}

// ---------------------------------------------------------------------------
// Regime Transition Detection
// ---------------------------------------------------------------------------

/**
 * Detect regime transitions from MBI history.
 * Classifies each day and reports changes.
 */
export function detectRegimeTransitions(
  history: Array<{ date: string; regime: string }>,
): RegimeTransition[] {
  const transitions: RegimeTransition[] = [];

  for (let i = 1; i < history.length; i++) {
    if (history[i].regime !== history[i - 1].regime) {
      transitions.push({
        date: history[i].date,
        from: history[i - 1].regime,
        to: history[i].regime,
      });
    }
  }

  return transitions;
}
