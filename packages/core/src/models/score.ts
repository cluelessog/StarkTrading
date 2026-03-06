export type ScoreStatus = 'PARTIAL' | 'COMPLETE';

export interface FactorResult {
  factorId: string;
  factorName: string;
  score: number;
  maxScore: number;
  dataSource: string;
  reasoning: string;
}

export interface ScoreBreakdown {
  factors: FactorResult[];
  algorithmicScore: number;
  discretionaryScore: number;
  totalScore: number;
  maxPossibleScore: number;
}

export interface StockScore {
  id?: number;
  symbol: string;
  token: string;
  name: string;
  scoringSessionId: string;
  status: ScoreStatus;
  breakdown: ScoreBreakdown;
  overrideCount: number;
  reviewedAt?: string;
  dataFreshness: 'fresh' | 'stale';
  createdAt: string;
  updatedAt: string;
}
