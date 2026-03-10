import type { FactorInput, FactorOutput } from '../registry.js';
import { previousTradingDay } from '../../utils/trading-calendar.js';

/**
 * EP Catalyst: gap >8% in last 5 trading days.
 * Gap = (day_open - prev_trading_day_close) / prev_close × 100
 * Corporate action filter: if split/bonus in window → EP = 0
 */
export async function epCatalyst(input: FactorInput): Promise<FactorOutput> {
  const { dailyBars } = input;

  if (dailyBars.length < 6) {
    return {
      score: 0,
      reasoning: 'Insufficient data (need at least 6 bars)',
      dataSource: 'ohlcv_cache',
    };
  }

  // Check last 5 trading days for a gap >8%
  const recentBars = dailyBars.slice(-6); // 6 bars = 5 gaps to check
  let maxGap = 0;
  let gapDate = '';

  for (let i = 1; i < recentBars.length; i++) {
    const prevClose = recentBars[i - 1].close;
    const currOpen = recentBars[i].open;

    if (prevClose <= 0) continue;

    // Verify days are adjacent trading days (skip corporate action gaps)
    const expectedPrev = previousTradingDay(recentBars[i].timestamp);
    if (expectedPrev !== recentBars[i - 1].timestamp) {
      // Gap between non-adjacent days could be a data gap, not a catalyst
      continue;
    }

    const gapPct = ((currOpen - prevClose) / prevClose) * 100;

    if (gapPct > maxGap) {
      maxGap = gapPct;
      gapDate = recentBars[i].timestamp;
    }
  }

  // If gap detected, verify it's not a corporate action via LLM
  if (maxGap >= 8 && input.llmService) {
    try {
      const research = await input.llmService.research(
        `Has ${input.symbol} had any stock splits, bonus issues, or corporate actions in the last 5 trading days? NSE India stock. Answer briefly.`,
      );
      if (research.answer.toLowerCase().includes('split') || research.answer.toLowerCase().includes('bonus')) {
        return {
          score: 0,
          reasoning: `Gap of ${maxGap.toFixed(1)}% on ${gapDate} — likely corporate action: ${research.answer.slice(0, 100)}`,
          dataSource: 'perplexity',
          metadata: { gapPct: maxGap, gapDate, corporateAction: true },
        };
      }
    } catch {
      // LLM failed, proceed with gap-only logic
      return {
        score: 0,
        reasoning: `Gap of ${maxGap.toFixed(1)}% on ${gapDate} — LLM unavailable for corporate action check`,
        dataSource: 'ohlcv_cache',
        degraded: true,
        metadata: { gapPct: maxGap, gapDate },
      };
    }
  }

  if (maxGap >= 8) {
    return {
      score: 1,
      reasoning: `Gap of ${maxGap.toFixed(1)}% on ${gapDate}`,
      dataSource: 'ohlcv_cache',
      metadata: { gapPct: maxGap, gapDate },
    };
  }

  // No gap — check for catalysts via LLM
  if (input.llmService) {
    try {
      const research = await input.llmService.research(
        `Has ${input.symbol} had any recent earnings surprises, regulatory approvals, major contracts, or catalysts in the last 5 trading days? NSE India stock. Answer briefly.`,
      );
      const hasPositive = /earnings|surprise|approval|contract|catalyst|strong|beat/i.test(research.answer);
      if (hasPositive) {
        return {
          score: 1,
          reasoning: `LLM-detected catalyst: ${research.answer.slice(0, 150)}`,
          dataSource: 'perplexity',
          metadata: { maxGap, llmCatalyst: true },
        };
      }
    } catch {
      return {
        score: 0,
        reasoning: `Max gap ${maxGap.toFixed(1)}% (threshold: 8%) — LLM unavailable for catalyst check`,
        dataSource: 'ohlcv_cache',
        degraded: true,
        metadata: { maxGap },
      };
    }
  }

  return {
    score: 0,
    reasoning: `Max gap ${maxGap.toFixed(1)}% (threshold: 8%)`,
    dataSource: 'ohlcv_cache',
    metadata: { maxGap },
  };
}
