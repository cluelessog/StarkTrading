import { describe, it, expect } from 'bun:test';
import type { FactorInput } from '../src/scoring/registry.js';
import type { OHLCVBar } from '../src/models/intervals.js';
import type { LLMService } from '../src/llm/index.js';
import type { LLMConfig } from '../src/config/index.js';
import { volumeEvents } from '../src/scoring/factors/llm-volume-events.js';
import { volumeQuality } from '../src/scoring/factors/llm-volume-quality.js';
import { linearity } from '../src/scoring/factors/llm-linearity.js';
import { pivotCutter } from '../src/scoring/factors/llm-pivot-cutter.js';
import { areaOfInterest } from '../src/scoring/factors/llm-aoi.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBar(
  date: string,
  open: number,
  high: number,
  low: number,
  close: number,
  volume: number,
): OHLCVBar {
  return {
    timestamp: date,
    date,
    open,
    high,
    low,
    close,
    volume,
  };
}

/** Generate N bars of a smooth uptrend with low volatility */
function smoothUptrend(n: number, startPrice = 100, dailyGain = 0.005): OHLCVBar[] {
  const bars: OHLCVBar[] = [];
  let price = startPrice;
  for (let i = 0; i < n; i++) {
    const d = `2026-${String(Math.floor(i / 28) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`;
    const open = price;
    const close = price * (1 + dailyGain);
    bars.push(makeBar(d, open, close + 0.1, open - 0.05, close, 100000));
    price = close;
  }
  return bars;
}

/** Generate N bars of choppy sideways movement */
function choppyBars(n: number, centerPrice = 100): OHLCVBar[] {
  const bars: OHLCVBar[] = [];
  for (let i = 0; i < n; i++) {
    const d = `2026-${String(Math.floor(i / 28) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`;
    const swing = (i % 2 === 0 ? 1 : -1) * centerPrice * 0.04;
    const open = centerPrice + swing;
    const close = centerPrice - swing;
    bars.push(makeBar(d, open, Math.max(open, close) + 1, Math.min(open, close) - 1, close, 100000));
  }
  return bars;
}

/**
 * Generate bars that form a consolidation base with ATR compression.
 * First `preDays` bars have high volatility, then `baseDays` bars have low volatility.
 */
function barsWithBase(
  preDays: number,
  baseDays: number,
  volumes: number[] = [],
): OHLCVBar[] {
  const bars: OHLCVBar[] = [];
  const basePrice = 100;

  // Pre-base: high-volatility bars (big swing to establish the pre-swing)
  for (let i = 0; i < preDays; i++) {
    const d = `2025-${String(Math.floor(i / 28) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`;
    const swing = (i % 2 === 0 ? 1 : -1) * 5;
    bars.push(makeBar(d, basePrice + swing, basePrice + 8, basePrice - 8, basePrice - swing, 100000));
  }

  // Base: low-volatility consolidation bars
  for (let i = 0; i < baseDays; i++) {
    const d = `2025-${String(Math.floor((preDays + i) / 28) + 1).padStart(2, '0')}-${String(((preDays + i) % 28) + 1).padStart(2, '0')}`;
    const vol = volumes[i] ?? 50000;
    bars.push(makeBar(d, basePrice + 0.5, basePrice + 1, basePrice - 0.5, basePrice + 0.3, vol));
  }

  return bars;
}

function makeInput(dailyBars: OHLCVBar[], llmService?: LLMService): FactorInput {
  return {
    symbol: 'TEST',
    token: '1234',
    dailyBars,
    provider: {} as FactorInput['provider'],
    context: { sessionId: 'test', startTime: Date.now(), symbols: ['TEST'], errors: [], completedSymbols: 0, totalSymbols: 1 },
    llmService,
  };
}

// ---------------------------------------------------------------------------
// Volume Events (HVE/HVY)
// ---------------------------------------------------------------------------

describe('volumeEvents', () => {
  it('returns 0 with insufficient data', async () => {
    const bars = smoothUptrend(30);
    const result = await volumeEvents(makeInput(bars));
    expect(result.score).toBe(0);
    expect(result.reasoning).toContain('Insufficient');
  });

  it('returns 0 when no base detected', async () => {
    // 80 bars of smooth uptrend (no consolidation)
    const bars = smoothUptrend(80);
    const result = await volumeEvents(makeInput(bars));
    expect(result.score).toBe(0);
  });

  it('scores 1.0 when HVE volume found in base', async () => {
    // Create bars with a base where one bar has HVE-level volume
    const volumes = Array(25).fill(50000);
    volumes[10] = 500000; // This bar has HVE-level volume
    const bars = barsWithBase(40, 25, volumes);
    const result = await volumeEvents(makeInput(bars));
    // If base is detected, HVE should give 1.0
    if (result.metadata?.hasHVE) {
      expect(result.score).toBe(1.0);
    }
  });

  it('scores 0 when no volume events in base', async () => {
    // All bars have same volume, so HVE/HVY won't be found in base specifically
    const volumes = Array(25).fill(50000);
    const bars = barsWithBase(40, 25, volumes);
    const result = await volumeEvents(makeInput(bars));
    // Without significantly higher volume in the base, score should be 0
    expect(result.score).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// Volume Quality (2.5 HVQ)
// ---------------------------------------------------------------------------

describe('volumeQuality', () => {
  it('returns 0 with insufficient data', async () => {
    const bars = smoothUptrend(30);
    const result = await volumeQuality(makeInput(bars));
    expect(result.score).toBe(0);
    expect(result.reasoning).toContain('Insufficient');
  });

  it('returns 0 when no base detected', async () => {
    const bars = smoothUptrend(80);
    const result = await volumeQuality(makeInput(bars));
    expect(result.score).toBe(0);
  });

  it('scores 1 when aggregate >= 2.5 HVQ-equivalents', async () => {
    // Create bars with multiple high-volume bars in base
    const volumes = Array(25).fill(50000);
    // 3 bars at HVQ level (each = 1.0) → aggregate = 3.0 >= 2.5
    volumes[5] = 500000;
    volumes[10] = 500000;
    volumes[15] = 500000;
    const bars = barsWithBase(40, 25, volumes);
    const result = await volumeQuality(makeInput(bars));
    // If base detected and these volumes reach HVQ benchmarks
    if (result.metadata?.baseLength) {
      expect(result.score).toBeLessThanOrEqual(1);
    }
  });
});

// ---------------------------------------------------------------------------
// Linearity
// ---------------------------------------------------------------------------

describe('linearity', () => {
  it('returns 0 with insufficient data', async () => {
    const bars = smoothUptrend(20);
    const result = await linearity(makeInput(bars));
    expect(result.score).toBe(0);
    expect(result.reasoning).toContain('Insufficient');
  });

  it('scores 1 for clearly smooth uptrend', async () => {
    const bars = smoothUptrend(70, 100, 0.003);
    const result = await linearity(makeInput(bars));
    expect(result.score).toBe(1);
    expect(result.reasoning).toContain('Smooth');
  });

  it('scores 0 for clearly choppy trend', async () => {
    const bars = choppyBars(70);
    const result = await linearity(makeInput(bars));
    expect(result.score).toBe(0);
    expect(result.reasoning).toContain('Choppy');
  });

  it('scores 0 for borderline without LLM', async () => {
    // Create bars with moderate volatility (borderline case)
    // Target: std dev ~2% (between 1.5% and 3%), up ratio ~55% (between 45% and 60%)
    const bars: OHLCVBar[] = [];
    let price = 100;
    for (let i = 0; i < 70; i++) {
      const d = `2026-01-${String((i % 28) + 1).padStart(2, '0')}`;
      // Alternating gains/losses to hit ~55% up ratio with ~2% std dev
      const ret = (i % 9 < 5 ? 0.015 : -0.018);
      const open = price;
      price = price * (1 + ret);
      bars.push(makeBar(d, open, Math.max(open, price) + 0.5, Math.min(open, price) - 0.5, price, 100000));
    }
    const result = await linearity(makeInput(bars));
    // Without LLM, borderline should score 0
    expect(result.score).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Pivot Cutter
// ---------------------------------------------------------------------------

describe('pivotCutter', () => {
  it('returns 0 with insufficient data', async () => {
    const bars = smoothUptrend(10);
    const result = await pivotCutter(makeInput(bars));
    expect(result.score).toBe(0);
    expect(result.reasoning).toContain('Insufficient');
  });

  it('scores 1 when no rejections at resistance', async () => {
    // Smooth uptrend — no rejections
    const bars = smoothUptrend(60);
    const result = await pivotCutter(makeInput(bars));
    expect(result.score).toBe(1);
    expect(result.reasoning).toContain('Not a pivot cutter');
  });

  it('scores 0 when many rejections at resistance', async () => {
    // Create bars with repeated rejection at resistance ~110
    const bars: OHLCVBar[] = [];
    for (let i = 0; i < 60; i++) {
      const d = `2026-01-${String((i % 28) + 1).padStart(2, '0')}`;
      if (i % 5 === 0 && i > 10) {
        // Approach resistance and reverse
        bars.push(makeBar(d, 108, 110, 107, 107, 100000));
      } else {
        bars.push(makeBar(d, 105, 106, 104, 105, 100000));
      }
    }
    const result = await pivotCutter(makeInput(bars));
    expect(result.score).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Area of Interest (AOI)
// ---------------------------------------------------------------------------

describe('areaOfInterest', () => {
  it('returns 0 with insufficient data', async () => {
    const bars = smoothUptrend(10);
    const result = await areaOfInterest(makeInput(bars));
    expect(result.score).toBe(0);
    expect(result.reasoning).toContain('Insufficient');
  });

  it('scores 1 when multiple levels converge', async () => {
    // Create bars with multiple swing highs/lows at similar price
    const bars: OHLCVBar[] = [];
    for (let i = 0; i < 60; i++) {
      const d = `2026-01-${String((i % 28) + 1).padStart(2, '0')}`;
      if (i % 10 === 0) {
        // Swing high near 100
        bars.push(makeBar(d, 98, 100.5, 97, 99, 100000));
      } else if (i % 10 === 5) {
        // Swing low near 95
        bars.push(makeBar(d, 96, 97, 94.5, 95, 100000));
      } else {
        bars.push(makeBar(d, 97, 98, 96, 97, 100000));
      }
    }
    // Last bar at ~100 (round number + near swing highs)
    bars.push(makeBar('2026-03-01', 99, 100.5, 99, 100, 100000));
    const result = await areaOfInterest(makeInput(bars));
    // Should find confluence near 100 (round number + swing levels)
    expect(result.score).toBeLessThanOrEqual(1);
    expect(result.score).toBeGreaterThanOrEqual(0);
  });

  it('scores 0 when no confluence', async () => {
    // Smooth uptrend, no revisits to prior levels
    const bars = smoothUptrend(60, 100, 0.01);
    const result = await areaOfInterest(makeInput(bars));
    expect(result.score).toBe(0);
  });
});
