import type { MBIRegime } from '../models/market.js';
import type { DatabaseAdapter } from '../db/adapter.js';
import type { FactorRegistry } from '../scoring/registry.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FocusStock {
  symbol: string;
  token: string;
  name: string;
  totalScore: number;
  maxScore: number;
  algorithmicScore: number;
  discretionaryScore: number;
}

export interface FocusListResult {
  regime: MBIRegime;
  threshold: number;
  maxStocks: number;
  stocks: FocusStock[];
}

// ---------------------------------------------------------------------------
// Threshold + limits per regime
// ---------------------------------------------------------------------------

const BASE_THRESHOLDS: Record<MBIRegime, number> = {
  STRONG_BULL: 7.5,
  BULL: 8.0,
  CAUTIOUS: 8.5,
  CHOPPY: 9.0,
  BEAR: 10.0,
};

const MAX_FOCUS: Record<MBIRegime, number> = {
  STRONG_BULL: 5,
  BULL: 5,
  CAUTIOUS: 3,
  CHOPPY: 2,
  BEAR: 0,
};

// ---------------------------------------------------------------------------
// Focus List Generator
// ---------------------------------------------------------------------------

export function generateFocusList(
  db: DatabaseAdapter,
  regime: MBIRegime,
  registry: FactorRegistry,
): FocusListResult {
  const baseThreshold = BASE_THRESHOLDS[regime];
  const threshold = registry.adjustedThreshold(baseThreshold);
  const maxStocks = MAX_FOCUS[regime];

  if (maxStocks === 0) {
    return { regime, threshold, maxStocks, stocks: [] };
  }

  // Get COMPLETE scores above threshold, ordered by score descending
  const rows = db.query<{
    symbol: string;
    token: string;
    name: string;
    total_score: number;
    max_possible_score: number;
    algorithmic_score: number;
    discretionary_score: number;
  }>(
    `SELECT symbol, token, name, total_score, max_possible_score,
            algorithmic_score, discretionary_score
     FROM stock_scores
     WHERE status = 'COMPLETE' AND total_score >= ?
     ORDER BY total_score DESC
     LIMIT ?`,
    [threshold, maxStocks],
  );

  const stocks: FocusStock[] = rows.map((r) => ({
    symbol: r.symbol,
    token: r.token,
    name: r.name,
    totalScore: r.total_score,
    maxScore: r.max_possible_score,
    algorithmicScore: r.algorithmic_score,
    discretionaryScore: r.discretionary_score,
  }));

  return { regime, threshold, maxStocks, stocks };
}
