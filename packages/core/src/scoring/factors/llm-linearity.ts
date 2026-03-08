import type { FactorInput, FactorOutput } from '../registry.js';

/**
 * Linearity: Is the prior uptrend smooth and linear?
 *
 * Algorithmic pre-filter:
 *   1. Compute daily returns over last 60 bars
 *   2. Calculate std dev of daily returns (choppiness measure)
 *   3. Compute up-day ratio (% of days with positive close-to-close)
 *   4. If clearly choppy (std dev > 3% or up-day ratio < 45%): score 0 without LLM
 *   5. If clearly smooth (std dev < 1.5% and up-day ratio > 60%): score 1 without LLM
 *   6. Borderline cases: use LLM if available
 */
export async function linearity(input: FactorInput): Promise<FactorOutput> {
  const { dailyBars, llmService, symbol } = input;

  if (dailyBars.length < 60) {
    return {
      score: 0,
      reasoning: 'Insufficient data for linearity analysis (need 60+ bars)',
      dataSource: 'ohlcv_cache',
    };
  }

  const recent = dailyBars.slice(-60);
  const returns: number[] = [];
  let upDays = 0;

  for (let i = 1; i < recent.length; i++) {
    const ret = (recent[i].close - recent[i - 1].close) / recent[i - 1].close;
    returns.push(ret);
    if (ret > 0) upDays++;
  }

  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance =
    returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
  const stdDev = Math.sqrt(variance) * 100; // as percentage
  const upRatio = upDays / returns.length;

  // Clear choppy: high volatility or too few up-days
  if (stdDev > 3 || upRatio < 0.45) {
    return {
      score: 0,
      reasoning: `Choppy trend: std dev ${stdDev.toFixed(2)}%, up-day ratio ${(upRatio * 100).toFixed(0)}%`,
      dataSource: 'ohlcv_cache',
      metadata: { stdDev, upRatio },
    };
  }

  // Clearly smooth
  if (stdDev < 1.5 && upRatio > 0.6) {
    return {
      score: 1,
      reasoning: `Smooth uptrend: std dev ${stdDev.toFixed(2)}%, up-day ratio ${(upRatio * 100).toFixed(0)}%`,
      dataSource: 'ohlcv_cache',
      metadata: { stdDev, upRatio },
    };
  }

  // Borderline — use LLM if available
  if (llmService && llmService.isEnabled({ enabled: true, geminiKey: 'check', cacheResponses: true, cacheTtlHours: 24 })) {
    try {
      const config = { enabled: true, geminiKey: 'check', cacheResponses: true, cacheTtlHours: 24 };
      const result = await llmService.analyzeOHLCV(
        `Analyze the trend linearity for ${symbol}. Is the uptrend over the last 60 days smooth and linear (clean diagonal) or choppy/staircase? Answer with score 1 for smooth linear, 0 for choppy. Consider: std dev of daily returns is ${stdDev.toFixed(2)}%, up-day ratio is ${(upRatio * 100).toFixed(0)}%.`,
        recent,
        config,
      );
      return {
        score: result.score >= 0.5 ? 1 : 0,
        reasoning: `LLM assessment: ${result.reasoning}`,
        dataSource: 'gemini',
        metadata: { stdDev, upRatio, llmScore: result.score, llmConfidence: result.confidence },
      };
    } catch {
      // LLM failed, fall through to fallback
    }
  }

  // No LLM available or LLM failed — conservative score for borderline
  return {
    score: 0,
    reasoning: `Borderline linearity (std dev ${stdDev.toFixed(2)}%, up-day ratio ${(upRatio * 100).toFixed(0)}%). LLM unavailable for nuanced assessment`,
    dataSource: 'ohlcv_cache',
    metadata: { stdDev, upRatio },
  };
}
