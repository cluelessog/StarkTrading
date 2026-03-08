import type { FactorType, FactorScoring, FactorSection } from '../models/factor.js';
import type { OHLCVBar } from '../models/intervals.js';
import type { DataProvider } from '../api/data-provider.js';
import type { ScoringContext } from './context.js';
import type { LLMService } from '../llm/index.js';

// ---------------------------------------------------------------------------
// Factor function signature
// ---------------------------------------------------------------------------

export interface FactorInput {
  symbol: string;
  token: string;
  dailyBars: OHLCVBar[];
  provider: DataProvider;
  context: ScoringContext;
  llmService?: LLMService;
}

export interface FactorOutput {
  score: number;
  reasoning: string;
  dataSource: string;
  metadata?: Record<string, unknown>;
}

export type FactorFunction = (input: FactorInput) => Promise<FactorOutput>;

// ---------------------------------------------------------------------------
// RegisteredFactor
// ---------------------------------------------------------------------------

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
  fn: FactorFunction | null; // null until wired in engine
}

// ---------------------------------------------------------------------------
// Factor Registry
// ---------------------------------------------------------------------------

export class FactorRegistry {
  private factors = new Map<string, RegisteredFactor>();

  register(factor: RegisteredFactor): void {
    this.factors.set(factor.id, factor);
  }

  get(id: string): RegisteredFactor | undefined {
    return this.factors.get(id);
  }

  getAll(): RegisteredFactor[] {
    return Array.from(this.factors.values());
  }

  getEnabled(): RegisteredFactor[] {
    return this.getAll().filter((f) => f.enabled);
  }

  getAlgorithmic(): RegisteredFactor[] {
    return this.getEnabled().filter(
      (f) => f.type === 'algorithmic' || f.type === 'semi-discretionary',
    );
  }

  getDiscretionary(): RegisteredFactor[] {
    return this.getEnabled().filter((f) => f.type === 'discretionary');
  }

  enable(id: string): void {
    const f = this.factors.get(id);
    if (f) f.enabled = true;
  }

  disable(id: string): void {
    const f = this.factors.get(id);
    if (f) f.enabled = false;
  }

  /** Max possible score from enabled factors */
  maxScore(): number {
    return this.getEnabled().reduce((sum, f) => sum + f.maxPoints, 0);
  }

  /**
   * Adjusted threshold when factors are disabled.
   * Formula: adjusted = round(base × (enabledMax / 13) × 2) / 2
   */
  adjustedThreshold(baseThreshold: number): number {
    const enabledMax = this.maxScore();
    return Math.round((baseThreshold * (enabledMax / 13)) * 2) / 2;
  }
}

// ---------------------------------------------------------------------------
// Default registry with all 13 factors
// ---------------------------------------------------------------------------

export function createDefaultRegistry(): FactorRegistry {
  const registry = new FactorRegistry();

  // Algorithmic factors (fn set to null here, wired in engine.ts)
  registry.register({
    id: 'ep_catalyst',
    name: 'EP Catalyst',
    section: 'X Factor',
    type: 'algorithmic',
    scoring: 'binary',
    maxPoints: 1,
    dataSource: 'Angel One OHLCV + News API',
    description: 'Earnings/catalyst gap >8% in last 5 trading days',
    guidanceText: 'Look for a significant gap up driven by a genuine catalyst (earnings, approval, contract)',
    enabled: true,
    fn: null,
  });

  registry.register({
    id: 'sector_strength',
    name: 'Sector Strength',
    section: 'Nature',
    type: 'algorithmic',
    scoring: 'binary',
    maxPoints: 1,
    dataSource: 'NSE sector indices',
    description: 'Sector outperforming Nifty 50',
    guidanceText: 'Stock should be in a sector showing relative strength vs the broad market',
    enabled: true,
    fn: null,
  });

  registry.register({
    id: 'high_rs',
    name: 'High Relative Strength',
    section: 'Nature',
    type: 'algorithmic',
    scoring: 'binary',
    maxPoints: 1,
    dataSource: 'Angel One OHLCV',
    description: 'Stock outperforming Nifty by >15% over 60 days',
    guidanceText: 'Stock should show strong relative strength vs the benchmark',
    enabled: true,
    fn: null,
  });

  registry.register({
    id: 'ipo_recency',
    name: 'IPO Recency',
    section: 'Nature',
    type: 'algorithmic',
    scoring: 'binary',
    maxPoints: 1,
    dataSource: 'Screener.in / Angel One master',
    description: 'Listed within last 2 years',
    guidanceText: 'Newer listings often show stronger momentum characteristics',
    enabled: true,
    fn: null,
  });

  registry.register({
    id: 'thrust_power',
    name: 'Thrust Power',
    section: 'Base Strength',
    type: 'algorithmic',
    scoring: 'binary',
    maxPoints: 1,
    dataSource: 'Angel One OHLCV',
    description: 'Max candle range ≥8% in last 60 days',
    guidanceText: 'A high-power candle shows institutional interest and conviction',
    enabled: true,
    fn: null,
  });

  registry.register({
    id: 'pivot_location',
    name: 'Pivot Location',
    section: 'Base Strength',
    type: 'algorithmic',
    scoring: 'graduated',
    maxPoints: 1,
    dataSource: 'Angel One OHLCV',
    description: 'ATR compression base detection + position scoring',
    guidanceText: 'Price should be consolidating near the top of a base with contracting volatility',
    enabled: true,
    fn: null,
  });

  registry.register({
    id: 'pattern_quality',
    name: 'Pattern Quality (VCP)',
    section: 'Base Strength',
    type: 'semi-discretionary',
    scoring: 'graduated',
    maxPoints: 1,
    dataSource: 'Angel One OHLCV + optional Gemini',
    description: 'VCP heuristic: contracting volatility pattern',
    guidanceText: 'Look for progressively tighter contractions with declining volume — classic VCP',
    enabled: true,
    fn: null,
  });

  registry.register({
    id: 'pivot_level_proximity',
    name: 'Pivot Level Proximity',
    section: 'Readiness',
    type: 'algorithmic',
    scoring: 'binary',
    maxPoints: 1,
    dataSource: 'Angel One OHLCV',
    description: 'Current price within 3% of pivot level',
    guidanceText: 'Stock should be near the breakout point, ready to move',
    enabled: true,
    fn: null,
  });

  // Semi-discretionary factors (LLM-assisted, fn wired in engine.ts)
  registry.register({
    id: 'linearity',
    name: 'Linearity',
    section: 'Nature',
    type: 'semi-discretionary',
    scoring: 'binary',
    maxPoints: 1,
    dataSource: 'OHLCV + optional Gemini',
    description: 'Prior uptrend is smooth and linear',
    guidanceText: 'The uptrend should look clean — smooth diagonal, not choppy or staircase',
    enabled: true,
    fn: null,
  });

  registry.register({
    id: 'not_pivot_cutter',
    name: 'NOT Pivot Cutter',
    section: 'Readiness',
    type: 'semi-discretionary',
    scoring: 'binary',
    maxPoints: 1,
    dataSource: 'OHLCV + optional Gemini',
    description: 'No history of false breakouts at pivot',
    guidanceText: 'Check: has this stock cut through its pivot and reversed recently? If yes, score 0',
    enabled: true,
    fn: null,
  });

  registry.register({
    id: 'aoi',
    name: 'Area of Interest (AOI)',
    section: 'Readiness',
    type: 'semi-discretionary',
    scoring: 'binary',
    maxPoints: 1,
    dataSource: 'OHLCV + optional Gemini',
    description: 'Price at a significant level of interest',
    guidanceText: 'Is the stock at a confluence zone — prior resistance, round number, moving average convergence?',
    enabled: true,
    fn: null,
  });

  registry.register({
    id: 'hve_hvy',
    name: 'HVE / HVY',
    section: 'Readiness',
    type: 'semi-discretionary',
    scoring: 'graduated',
    maxPoints: 1,
    dataSource: 'Angel One OHLCV',
    description: 'Highest Volume Ever / Highest Volume Year in base',
    guidanceText: 'HVE present → 1.0, HVY present → 0.5, neither → 0',
    enabled: true,
    fn: null,
  });

  registry.register({
    id: 'hvq_2_5',
    name: '2.5 HVQ',
    section: 'Readiness',
    type: 'semi-discretionary',
    scoring: 'binary',
    maxPoints: 1,
    dataSource: 'Angel One OHLCV',
    description: 'Aggregated volume quality ≥2.5 HVQ-equivalents in base',
    guidanceText: 'Sum weighted volume bars in base: HVE=2.0, HVY=1.5, HVQ=1.0. Score 1 if aggregate ≥2.5',
    enabled: true,
    fn: null,
  });

  return registry;
}
