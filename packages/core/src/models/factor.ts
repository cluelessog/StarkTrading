import type { OHLCVBar } from './intervals.js';

export type FactorType = 'algorithmic' | 'semi-discretionary' | 'discretionary';
export type FactorScoring = 'binary' | 'graduated';
export type FactorSection = 'X Factor' | 'Nature' | 'Base Strength' | 'Readiness';

export interface FactorInput {
  symbol: string;
  ohlcv: OHLCVBar[];
  niftyOhlcv?: OHLCVBar[];
  sectorIndexOhlcv?: OHLCVBar[];
  listingDate?: string;
  newsHeadlines?: string[];
}

export type FactorFunction = (input: FactorInput) => Promise<{ score: number; reasoning: string; dataSource: string }>;

export interface RegisteredFactor {
  id: string;
  name: string;
  section: FactorSection;
  type: FactorType;
  scoring: FactorScoring;
  maxPoints: number;
  dataSource: string;
  description: string;
  guidanceText: string;
  enabled: boolean;
  fn: FactorFunction;
}
