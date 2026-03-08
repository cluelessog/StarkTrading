import type { FactorInput, FactorOutput } from '../registry.js';

/**
 * Area of Interest (AOI): Is the stock at a significant confluence zone?
 *
 * Algorithm:
 *   1. Calculate prior resistance levels from last 120 bars
 *   2. Check round number proximity (within 1%)
 *   3. Check if multiple support/resistance levels converge within 2%
 *   4. If clear confluence: score 1 algorithmically
 *   5. If borderline and llmService available: send to Gemini
 */
export async function areaOfInterest(input: FactorInput): Promise<FactorOutput> {
  const { dailyBars, llmService, symbol } = input;

  if (dailyBars.length < 30) {
    return {
      score: 0,
      reasoning: 'Insufficient data for AOI analysis (need 30+ bars)',
      dataSource: 'ohlcv_cache',
    };
  }

  const currentPrice = dailyBars[dailyBars.length - 1].close;
  const levels: number[] = [];

  // Find prior resistance levels (swing highs)
  const lookback = Math.min(dailyBars.length, 120);
  const bars = dailyBars.slice(-lookback);

  for (let i = 2; i < bars.length - 2; i++) {
    if (
      bars[i].high > bars[i - 1].high &&
      bars[i].high > bars[i - 2].high &&
      bars[i].high > bars[i + 1].high &&
      bars[i].high > bars[i + 2].high
    ) {
      levels.push(bars[i].high);
    }
  }

  // Find prior support levels (swing lows)
  for (let i = 2; i < bars.length - 2; i++) {
    if (
      bars[i].low < bars[i - 1].low &&
      bars[i].low < bars[i - 2].low &&
      bars[i].low < bars[i + 1].low &&
      bars[i].low < bars[i + 2].low
    ) {
      levels.push(bars[i].low);
    }
  }

  // Check round number proximity (within 1%)
  const roundNumbers = [
    Math.floor(currentPrice / 100) * 100,
    Math.ceil(currentPrice / 100) * 100,
    Math.floor(currentPrice / 50) * 50,
    Math.ceil(currentPrice / 50) * 50,
  ];
  const nearRound = roundNumbers.some(
    (rn) => Math.abs(currentPrice - rn) / currentPrice < 0.01,
  );

  // Count levels converging within 2% of current price
  const nearbyLevels = levels.filter(
    (level) => Math.abs(currentPrice - level) / currentPrice < 0.02,
  );

  const confluenceCount = nearbyLevels.length + (nearRound ? 1 : 0);

  // Clear confluence: 3+ levels converging
  if (confluenceCount >= 3) {
    return {
      score: 1,
      reasoning: `Strong AOI: ${confluenceCount} levels converging near ${currentPrice.toFixed(2)} (${nearbyLevels.length} S/R levels${nearRound ? ' + round number' : ''})`,
      dataSource: 'ohlcv_cache',
      metadata: { confluenceCount, nearbyLevels, nearRound },
    };
  }

  // No confluence at all
  if (confluenceCount === 0) {
    return {
      score: 0,
      reasoning: `No AOI: 0 levels converging near ${currentPrice.toFixed(2)}`,
      dataSource: 'ohlcv_cache',
      metadata: { confluenceCount },
    };
  }

  // Borderline (1-2 levels) — use LLM if available
  if (llmService && llmService.isEnabled({ enabled: true, geminiKey: 'check', cacheResponses: true, cacheTtlHours: 24 })) {
    try {
      const config = { enabled: true, geminiKey: 'check', cacheResponses: true, cacheTtlHours: 24 };
      const result = await llmService.analyzeOHLCV(
        `Analyze ${symbol} at price ${currentPrice.toFixed(2)} for Area of Interest. There are ${nearbyLevels.length} support/resistance levels nearby${nearRound ? ' and the price is near a round number' : ''}. Is this a significant confluence zone? Score 1 for significant AOI, 0 for not significant.`,
        bars,
        config,
      );
      return {
        score: result.score >= 0.5 ? 1 : 0,
        reasoning: `LLM assessment: ${result.reasoning}`,
        dataSource: 'gemini',
        metadata: { confluenceCount, nearbyLevels, nearRound, llmScore: result.score },
      };
    } catch {
      // LLM failed, fall through
    }
  }

  // Fallback: conservative
  return {
    score: 0,
    reasoning: `Borderline AOI: ${confluenceCount} level(s) near ${currentPrice.toFixed(2)}. LLM unavailable for nuanced assessment`,
    dataSource: 'ohlcv_cache',
    metadata: { confluenceCount, nearbyLevels, nearRound },
  };
}
