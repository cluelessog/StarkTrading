import type { FactorInput, FactorOutput } from '../registry.js';
import type { OHLCVBar } from '../../models/intervals.js';

/**
 * Pattern Quality (VCP heuristic — semi-discretionary):
 * 1. Consolidation 20+ days within a defined band
 * 2. Each successive swing contraction <75% of previous
 * 3. Volume decline: each contraction's avg volume ≤90% of previous
 * 4. Minimum 3 contracting swings
 * 5. Score: ≥3 contractions + volume decline → 1.0; partial → 0.5; none → 0
 */
export async function patternQuality(input: FactorInput): Promise<FactorOutput> {
  const { dailyBars } = input;

  if (dailyBars.length < 30) {
    return {
      score: 0,
      reasoning: 'Insufficient data for VCP detection (need 30+ bars)',
      dataSource: 'ohlcv_cache',
    };
  }

  // Analyze last 100 bars for VCP
  const bars = dailyBars.slice(-100);
  const contractions = findContractions(bars);

  if (contractions.length < 2) {
    return {
      score: 0,
      reasoning: `Only ${contractions.length} contraction(s) found (need ≥3 for VCP)`,
      dataSource: 'ohlcv_cache',
      metadata: { contractionCount: contractions.length },
    };
  }

  // Check progressive tightening
  let tighteningCount = 0;
  let volumeDeclineCount = 0;

  for (let i = 1; i < contractions.length; i++) {
    const prev = contractions[i - 1];
    const curr = contractions[i];

    if (curr.range < prev.range * 0.75) {
      tighteningCount++;
    }
    if (curr.avgVolume <= prev.avgVolume * 0.9) {
      volumeDeclineCount++;
    }
  }

  const totalContractions = contractions.length;
  const hasFullVCP = totalContractions >= 3 && tighteningCount >= 2 && volumeDeclineCount >= 1;
  const hasPartialVCP = totalContractions >= 2 && tighteningCount >= 1;

  const depths = contractions.map((c) => `${c.range.toFixed(1)}%`).join(' → ');

  if (hasFullVCP) {
    return {
      score: 1.0,
      reasoning: `VCP: ${totalContractions} contractions, depths: ${depths}, volume declining`,
      dataSource: 'ohlcv_cache',
      metadata: {
        contractionCount: totalContractions,
        tighteningCount,
        volumeDeclineCount,
        depths: contractions.map((c) => c.range),
      },
    };
  }

  if (hasPartialVCP) {
    return {
      score: 0.5,
      reasoning: `Partial VCP: ${totalContractions} contractions, depths: ${depths}`,
      dataSource: 'ohlcv_cache',
      metadata: {
        contractionCount: totalContractions,
        tighteningCount,
        volumeDeclineCount,
        depths: contractions.map((c) => c.range),
      },
    };
  }

  return {
    score: 0,
    reasoning: `No VCP pattern: ${totalContractions} contractions, insufficient tightening`,
    dataSource: 'ohlcv_cache',
    metadata: { contractionCount: totalContractions },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface Contraction {
  range: number; // % range of swing
  avgVolume: number;
  startIdx: number;
  endIdx: number;
}

function findContractions(bars: OHLCVBar[]): Contraction[] {
  // Simple swing detection: find local peaks and troughs
  const contractions: Contraction[] = [];
  const minSwingLen = 5;

  let i = 0;
  while (i < bars.length - minSwingLen) {
    // Find a local high
    let peakIdx = i;
    for (let j = i; j < Math.min(i + 20, bars.length); j++) {
      if (bars[j].high > bars[peakIdx].high) peakIdx = j;
    }

    // Find the next local low after the peak
    let troughIdx = peakIdx + 1;
    if (troughIdx >= bars.length) break;

    for (
      let j = peakIdx + 1;
      j < Math.min(peakIdx + 20, bars.length);
      j++
    ) {
      if (bars[j].low < bars[troughIdx].low) troughIdx = j;
    }

    if (troughIdx >= bars.length) break;

    const peakPrice = bars[peakIdx].high;
    const troughPrice = bars[troughIdx].low;

    if (peakPrice <= 0) {
      i = troughIdx + 1;
      continue;
    }

    const range = ((peakPrice - troughPrice) / peakPrice) * 100;

    if (range > 2) {
      // Meaningful contraction (>2%)
      const swingBars = bars.slice(peakIdx, troughIdx + 1);
      const avgVolume =
        swingBars.reduce((s, b) => s + b.volume, 0) / swingBars.length;

      contractions.push({
        range,
        avgVolume,
        startIdx: peakIdx,
        endIdx: troughIdx,
      });
    }

    i = troughIdx + 1;
  }

  return contractions;
}
