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

  if (maxGap >= 8) {
    return {
      score: 1,
      reasoning: `Gap of ${maxGap.toFixed(1)}% on ${gapDate}`,
      dataSource: 'ohlcv_cache',
      metadata: { gapPct: maxGap, gapDate },
    };
  }

  return {
    score: 0,
    reasoning: `Max gap ${maxGap.toFixed(1)}% (threshold: 8%)`,
    dataSource: 'ohlcv_cache',
    metadata: { maxGap },
  };
}
