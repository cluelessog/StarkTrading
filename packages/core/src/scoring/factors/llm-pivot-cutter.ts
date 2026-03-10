import type { FactorInput, FactorOutput } from '../registry.js';

/**
 * NOT Pivot Cutter: Has this stock historically cut through pivots and reversed?
 *
 * Algorithm:
 *   1. Identify resistance level (highest high in last 20 bars)
 *   2. Count rejection approaches: price came within 1% of resistance then reversed
 *   3. If rejections >= 3: score 0 (IS a pivot cutter) without LLM
 *   4. If rejections 0: score 1 (NOT a pivot cutter) without LLM
 *   5. If rejections 1-2 and llmService available: send to Gemini for nuanced assessment
 */
export async function pivotCutter(input: FactorInput): Promise<FactorOutput> {
  const { dailyBars, llmService, symbol } = input;

  if (dailyBars.length < 30) {
    return {
      score: 0,
      reasoning: 'Insufficient data for pivot cutter analysis (need 30+ bars)',
      dataSource: 'ohlcv_cache',
    };
  }

  // Use last 60 bars for analysis (or all if fewer)
  const analysisWindow = dailyBars.slice(-60);

  // Find resistance level: highest high in last 20 bars
  const recentBars = analysisWindow.slice(-20);
  const resistance = Math.max(...recentBars.map((b) => b.high));
  const threshold = resistance * 0.01; // 1% proximity

  // Count rejection approaches in the full analysis window
  let rejections = 0;
  for (let i = 1; i < analysisWindow.length - 1; i++) {
    const bar = analysisWindow[i];
    const nextBar = analysisWindow[i + 1];

    // Price approached resistance (high within 1%)
    if (bar.high >= resistance - threshold && bar.high <= resistance + threshold) {
      // And then reversed (next bar closed lower)
      if (nextBar.close < bar.close) {
        rejections++;
      }
    }
  }

  // Clear cases — no LLM needed
  if (rejections >= 3) {
    return {
      score: 0,
      reasoning: `Pivot cutter: ${rejections} rejection(s) at resistance ${resistance.toFixed(2)}`,
      dataSource: 'ohlcv_cache',
      metadata: { rejections, resistance },
    };
  }

  if (rejections === 0) {
    return {
      score: 1,
      reasoning: `Not a pivot cutter: 0 rejections at resistance ${resistance.toFixed(2)}`,
      dataSource: 'ohlcv_cache',
      metadata: { rejections, resistance },
    };
  }

  // Ambiguous (1-2 rejections) — use LLM if available
  if (llmService) {
    try {
      const result = await llmService.analyzeOHLCV(
        `Analyze ${symbol} for pivot cutting behavior. Resistance is at ${resistance.toFixed(2)}. There have been ${rejections} rejection(s) at this level. Is this stock a pivot cutter (tends to break above resistance then reverse)? Score 1 if NOT a pivot cutter, 0 if it IS a pivot cutter.`,
        analysisWindow,
      );
      return {
        score: result.score >= 0.5 ? 1 : 0,
        reasoning: `LLM assessment (${rejections} rejections): ${result.reasoning}`,
        dataSource: llmService.getAnalysisProvider(),
        metadata: { rejections, resistance, llmScore: result.score },
      };
    } catch {
      // LLM failed, fall through
      return {
        score: 0,
        reasoning: `Ambiguous: ${rejections} rejection(s) at resistance ${resistance.toFixed(2)}. LLM failed`,
        dataSource: 'ohlcv_cache',
        metadata: { rejections, resistance },
        degraded: true,
      };
    }
  }

  // Fallback: conservative for ambiguous cases
  return {
    score: 0,
    reasoning: `Ambiguous: ${rejections} rejection(s) at resistance ${resistance.toFixed(2)}. LLM unavailable for nuanced assessment`,
    dataSource: 'ohlcv_cache',
    metadata: { rejections, resistance },
  };
}
