import type { DataProvider } from '../api/data-provider.js';
import type { OHLCVBar } from '../models/intervals.js';
import type { FactorResult } from '../models/score.js';
import type { DatabaseAdapter } from '../db/adapter.js';
import type { LLMService } from '../llm/index.js';
import { Queries } from '../db/queries.js';
import {
  type FactorRegistry,
  type FactorInput,
  type FactorOutput,
  createDefaultRegistry,
} from './registry.js';
import {
  type ScoringContext,
  createScoringContext,
  trackError,
  completeContext,
} from './context.js';
import { epCatalyst } from './factors/ep-catalyst.js';
import { sectorStrength } from './factors/sector-strength.js';
import { highRS } from './factors/high-rs.js';
import { ipoRecency } from './factors/ipo-recency.js';
import { thrustPower } from './factors/thrust-power.js';
import { pivotLocation } from './factors/pivot-location.js';
import { patternQuality } from './factors/pattern-quality.js';
import { pivotLevelProximity } from './factors/pivot-level.js';
import { linearity } from './factors/llm-linearity.js';
import { pivotCutter } from './factors/llm-pivot-cutter.js';
import { areaOfInterest } from './factors/llm-aoi.js';
import { volumeEvents } from './factors/llm-volume-events.js';
import { volumeQuality } from './factors/llm-volume-quality.js';

// ---------------------------------------------------------------------------
// Map factor IDs to their implementations
// ---------------------------------------------------------------------------

const FACTOR_FNS: Record<string, (input: FactorInput) => Promise<FactorOutput>> = {
  ep_catalyst: epCatalyst,
  sector_strength: sectorStrength,
  high_rs: highRS,
  ipo_recency: ipoRecency,
  thrust_power: thrustPower,
  pivot_location: pivotLocation,
  pattern_quality: patternQuality,
  pivot_level_proximity: pivotLevelProximity,
  linearity,
  not_pivot_cutter: pivotCutter,
  aoi: areaOfInterest,
  hve_hvy: volumeEvents,
  hvq_2_5: volumeQuality,
};

// ---------------------------------------------------------------------------
// Score result
// ---------------------------------------------------------------------------

/** @deprecated Use ScoreResult instead */
export type AlgorithmicScoreResult = ScoreResult;

export interface ScoreResult {
  symbol: string;
  token: string;
  factors: FactorResult[];
  algorithmicScore: number;
  discretionaryScore: number;
  totalScore: number;
  maxPossibleScore: number;
  status: 'PARTIAL' | 'COMPLETE';
}

// ---------------------------------------------------------------------------
// ScoringEngine
// ---------------------------------------------------------------------------

export class ScoringEngine {
  private registry: FactorRegistry;
  private queries: Queries;
  private llmService?: LLMService;

  constructor(
    private provider: DataProvider,
    db: DatabaseAdapter,
    registry?: FactorRegistry,
    llmService?: LLMService,
  ) {
    this.llmService = llmService;
    this.registry = registry ?? createDefaultRegistry();
    this.queries = new Queries(db);

    // Wire factor functions into registry
    for (const factor of this.registry.getAll()) {
      const fn = FACTOR_FNS[factor.id];
      if (fn) {
        factor.fn = fn;
      }
    }
  }

  getRegistry(): FactorRegistry {
    return this.registry;
  }

  async scoreSymbol(
    symbol: string,
    token: string,
    context: ScoringContext,
  ): Promise<ScoreResult> {
    // Fetch OHLCV data (last 120 trading days for all factors)
    const to = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);

    let dailyBars: OHLCVBar[];
    try {
      dailyBars = await this.provider.fetchOHLCV(symbol, token, '1d', from, to);
    } catch (err) {
      trackError(context, symbol, 'ohlcv_fetch', (err as Error).message);
      dailyBars = [];
    }

    const algorithmicFactors = this.registry.getAlgorithmic();
    const factors: FactorResult[] = [];
    let algorithmicScore = 0;
    let discretionaryScore = 0;
    const semiDiscretionaryIds = new Set(['linearity', 'not_pivot_cutter', 'aoi', 'hve_hvy', 'hvq_2_5']);

    for (const factor of algorithmicFactors) {
      if (!factor.fn) continue;

      const input: FactorInput = {
        symbol,
        token,
        dailyBars,
        provider: this.provider,
        context,
        llmService: this.llmService,
      };

      try {
        const output = await factor.fn(input);
        factors.push({
          factorId: factor.id,
          factorName: factor.name,
          score: output.score,
          maxScore: factor.maxPoints,
          reasoning: output.reasoning,
          dataSource: output.dataSource,
        });
        if (semiDiscretionaryIds.has(factor.id)) {
          discretionaryScore += output.score;
        } else {
          algorithmicScore += output.score;
        }
      } catch (err) {
        trackError(context, symbol, factor.id, (err as Error).message);
        factors.push({
          factorId: factor.id,
          factorName: factor.name,
          score: 0,
          maxScore: factor.maxPoints,
          reasoning: `Error: ${(err as Error).message}`,
          dataSource: 'error',
        });
      }
    }

    const totalScore = algorithmicScore + discretionaryScore;
    const allFactorsScored = factors.length === this.registry.getEnabled().length;
    const status: 'PARTIAL' | 'COMPLETE' = allFactorsScored ? 'COMPLETE' : 'PARTIAL';

    return {
      symbol,
      token,
      factors,
      algorithmicScore,
      discretionaryScore,
      totalScore,
      maxPossibleScore: this.registry.maxScore(),
      status,
    };
  }

  async scoreBatch(
    symbols: Array<{ symbol: string; token: string; name: string }>,
  ): Promise<{
    results: ScoreResult[];
    context: ScoringContext;
  }> {
    const context = createScoringContext(symbols.map((s) => s.symbol));
    const results: ScoreResult[] = [];

    for (const { symbol, token, name } of symbols) {
      const result = await this.scoreSymbol(symbol, token, context);
      results.push(result);

      // Store in DB
      this.queries.insertStockScore({
        symbol,
        token,
        name,
        scoringSessionId: context.sessionId,
        status: result.status,
        breakdown: {
          factors: result.factors,
          algorithmicScore: result.algorithmicScore,
          discretionaryScore: result.discretionaryScore,
          totalScore: result.totalScore,
          maxPossibleScore: result.maxPossibleScore,
        },
        overrideCount: 0,
        dataFreshness: 'fresh',
        epCatalyst: factorScore(result, 'ep_catalyst'),
        sectorStrength: factorScore(result, 'sector_strength'),
        highRs: factorScore(result, 'high_rs'),
        ipoRecency: factorScore(result, 'ipo_recency'),
        thrustPower: factorScore(result, 'thrust_power'),
        pivotLocation: factorScore(result, 'pivot_location'),
        patternQuality: factorScore(result, 'pattern_quality'),
        pivotLevelProximity: factorScore(result, 'pivot_level_proximity'),
        linearity: factorScore(result, 'linearity'),
        notPivotCutter: factorScore(result, 'not_pivot_cutter'),
        aoi: factorScore(result, 'aoi'),
        hveHvy: factorScore(result, 'hve_hvy'),
        hvq2_5: factorScore(result, 'hvq_2_5'),
      });
    }

    completeContext(context);
    return { results, context };
  }
}

function factorScore(
  result: ScoreResult,
  factorId: string,
): number | undefined {
  return result.factors.find((f) => f.factorId === factorId)?.score;
}
