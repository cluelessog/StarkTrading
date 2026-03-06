import type { FactorInput, FactorOutput } from '../registry.js';
import type { OHLCVBar } from '../../models/intervals.js';

/**
 * Pivot Location: ATR compression base detection + position scoring.
 *
 * Algorithm:
 * 1. Compute rolling 10-day ATR
 * 2. Find consolidation period (20-100 days) where ATR contracts to ≤50% of start
 * 3. Price channel (highest high to lowest low) ≤30% of pre-consolidation swing
 * 4. Pivot = channel high (breakout level)
 * 5. Score: lower third = 0, middle third = 0.5, upper third = 1.0
 * 6. No valid base → 0
 */
export async function pivotLocation(input: FactorInput): Promise<FactorOutput> {
  const { dailyBars } = input;

  if (dailyBars.length < 30) {
    return {
      score: 0,
      reasoning: 'Insufficient data for base detection (need 30+ bars)',
      dataSource: 'ohlcv_cache',
    };
  }

  // Compute 10-day ATR for all bars
  const atrs = computeATR(dailyBars, 10);

  // Try to find a consolidation base in the last 100 bars
  const lookback = Math.min(dailyBars.length, 120);
  const searchBars = dailyBars.slice(-lookback);
  const searchATRs = atrs.slice(-lookback);

  const base = findBase(searchBars, searchATRs);

  if (!base) {
    return {
      score: 0,
      reasoning: 'No valid consolidation base detected',
      dataSource: 'ohlcv_cache',
    };
  }

  // Current price position within the base
  const currentPrice = dailyBars[dailyBars.length - 1].close;
  const baseRange = base.channelHigh - base.channelLow;

  if (baseRange <= 0) {
    return {
      score: 0,
      reasoning: 'Invalid base range',
      dataSource: 'ohlcv_cache',
    };
  }

  const position = (currentPrice - base.channelLow) / baseRange;

  let score: number;
  let label: string;
  if (position >= 2 / 3) {
    score = 1.0;
    label = 'upper third (near pivot)';
  } else if (position >= 1 / 3) {
    score = 0.5;
    label = 'middle third';
  } else {
    score = 0;
    label = 'lower third';
  }

  return {
    score,
    reasoning: `Base: ${base.length} days, ATR compression ${base.atrCompression.toFixed(0)}%. Price in ${label}. Pivot: ${base.channelHigh.toFixed(2)}`,
    dataSource: 'ohlcv_cache',
    metadata: {
      baseLength: base.length,
      channelHigh: base.channelHigh,
      channelLow: base.channelLow,
      atrCompression: base.atrCompression,
      pricePosition: position,
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface BaseResult {
  length: number;
  channelHigh: number;
  channelLow: number;
  atrCompression: number;
}

function computeATR(bars: OHLCVBar[], period: number): number[] {
  const trs: number[] = [];

  for (let i = 0; i < bars.length; i++) {
    if (i === 0) {
      trs.push(bars[i].high - bars[i].low);
    } else {
      const prevClose = bars[i - 1].close;
      const tr = Math.max(
        bars[i].high - bars[i].low,
        Math.abs(bars[i].high - prevClose),
        Math.abs(bars[i].low - prevClose),
      );
      trs.push(tr);
    }
  }

  // Simple moving average of TR
  const atrs: number[] = [];
  for (let i = 0; i < trs.length; i++) {
    if (i < period - 1) {
      atrs.push(0);
    } else {
      let sum = 0;
      for (let j = i - period + 1; j <= i; j++) sum += trs[j];
      atrs.push(sum / period);
    }
  }

  return atrs;
}

function findBase(
  bars: OHLCVBar[],
  atrs: number[],
): BaseResult | null {
  // Look for consolidation: scan backwards from recent
  // Try different start points for the consolidation
  for (let startIdx = bars.length - 20; startIdx >= 0; startIdx--) {
    const startATR = atrs[startIdx];
    if (startATR <= 0) continue;

    // Extend the base from startIdx forward
    for (
      let endIdx = startIdx + 19; // min 20 days
      endIdx < Math.min(startIdx + 100, bars.length);
      endIdx++
    ) {
      const endATR = atrs[endIdx];
      if (endATR <= 0) continue;

      const compression = (endATR / startATR) * 100;
      if (compression > 50) continue; // ATR hasn't compressed enough

      // Check price channel width
      const baseBars = bars.slice(startIdx, endIdx + 1);
      const channelHigh = Math.max(...baseBars.map((b) => b.high));
      const channelLow = Math.min(...baseBars.map((b) => b.low));
      const channelWidth = channelHigh - channelLow;

      // Pre-consolidation swing: use bars before startIdx
      if (startIdx < 5) continue;
      const preBars = bars.slice(Math.max(0, startIdx - 20), startIdx);
      const preHigh = Math.max(...preBars.map((b) => b.high));
      const preLow = Math.min(...preBars.map((b) => b.low));
      const preSwing = preHigh - preLow;

      if (preSwing <= 0) continue;
      if (channelWidth / preSwing > 0.3) continue; // Channel too wide

      return {
        length: endIdx - startIdx + 1,
        channelHigh,
        channelLow,
        atrCompression: compression,
      };
    }
  }

  return null;
}
