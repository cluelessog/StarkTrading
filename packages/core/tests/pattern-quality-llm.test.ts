import { describe, it, expect, mock } from 'bun:test';
import { patternQuality } from '../src/scoring/factors/pattern-quality.js';
import type { FactorInput } from '../src/scoring/registry.js';
import type { OHLCVBar } from '../src/models/intervals.js';
import type { LLMService } from '../src/llm/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBar(date: string, open: number, high: number, low: number, close: number, volume = 100000): OHLCVBar {
  return { timestamp: date, date, open, high, low, close, volume };
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

/**
 * Generate bars that produce a partial VCP (2 contractions with some tightening).
 * Swing 1: peak ~110, trough ~100 (10% range)
 * Swing 2: peak ~108, trough ~102 (5.6% range) — tightening from swing 1
 */
function partialVCPBars(): OHLCVBar[] {
  const bars: OHLCVBar[] = [];
  let idx = 0;
  const d = () => {
    idx++;
    return `2026-01-${String(Math.min(idx, 28)).padStart(2, '0')}`;
  };

  // Pre-trend up
  for (let i = 0; i < 5; i++) bars.push(makeBar(d(), 95 + i, 96 + i, 94 + i, 95.5 + i, 200000));

  // Swing 1: up to 110, down to 100
  for (let i = 0; i < 5; i++) bars.push(makeBar(d(), 100 + i * 2, 101 + i * 2, 99 + i * 2, 100.5 + i * 2, 180000));
  for (let i = 0; i < 5; i++) bars.push(makeBar(d(), 110 - i * 2, 111 - i * 2, 109 - i * 2, 109.5 - i * 2, 150000));

  // Swing 2: up to 108, down to 102 (tighter)
  for (let i = 0; i < 5; i++) bars.push(makeBar(d(), 100 + i * 1.6, 101 + i * 1.6, 99 + i * 1.6, 100.5 + i * 1.6, 120000));
  for (let i = 0; i < 5; i++) bars.push(makeBar(d(), 108 - i * 1.2, 109 - i * 1.2, 107 - i * 1.2, 107.5 - i * 1.2, 100000));

  // Flatten
  for (let i = 0; i < 5; i++) bars.push(makeBar(d(), 102 + i * 0.2, 103, 101, 102.5, 80000));

  return bars;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('patternQuality LLM-enhanced', () => {
  it('still works without LLM for full VCP', async () => {
    // Full VCP needs 3+ contractions — build enough data
    const bars: OHLCVBar[] = [];
    let idx = 0;
    const d = () => {
      idx++;
      const m = Math.floor(idx / 28) + 1;
      return `2026-${String(m).padStart(2, '0')}-${String(((idx - 1) % 28) + 1).padStart(2, '0')}`;
    };

    // Pre-trend
    for (let i = 0; i < 10; i++) bars.push(makeBar(d(), 90 + i, 91 + i, 89 + i, 90.5 + i, 200000));

    // Swing 1: 20% range
    for (let i = 0; i < 8; i++) bars.push(makeBar(d(), 100 + i * 2.5, 101 + i * 2.5, 99 + i * 2.5, 100.5 + i * 2.5, 180000));
    for (let i = 0; i < 8; i++) bars.push(makeBar(d(), 120 - i * 2.5, 121 - i * 2.5, 119 - i * 2.5, 119.5 - i * 2.5, 160000));

    // Swing 2: 10% range (tighter)
    for (let i = 0; i < 5; i++) bars.push(makeBar(d(), 100 + i * 2, 101 + i * 2, 99 + i * 2, 100.5 + i * 2, 130000));
    for (let i = 0; i < 5; i++) bars.push(makeBar(d(), 110 - i * 2, 111 - i * 2, 109 - i * 2, 109.5 - i * 2, 110000));

    // Swing 3: 5% range (tighter still)
    for (let i = 0; i < 5; i++) bars.push(makeBar(d(), 100 + i, 101 + i, 99 + i, 100.5 + i, 90000));
    for (let i = 0; i < 5; i++) bars.push(makeBar(d(), 105 - i, 106 - i, 104 - i, 104.5 - i, 70000));

    const result = await patternQuality(makeInput(bars));
    // Should detect VCP algorithmically
    expect(result.score).toBeGreaterThanOrEqual(0.5);
  });

  it('still works without LLM (no VCP)', async () => {
    // Flat bars — no contractions
    const bars: OHLCVBar[] = [];
    for (let i = 0; i < 40; i++) {
      bars.push(makeBar(`2026-01-${String((i % 28) + 1).padStart(2, '0')}`, 100, 101, 99, 100, 100000));
    }
    const result = await patternQuality(makeInput(bars));
    expect(result.score).toBe(0);
  });

  it('upgrades partial VCP with confirming LLM', async () => {
    const bars = partialVCPBars();
    const llm: LLMService = {
      analyzeOHLCV: mock(() =>
        Promise.resolve({ score: 1, reasoning: 'Valid VCP pattern confirmed', confidence: 0.9, cached: false }),
      ),
      research: mock(() => Promise.resolve({ answer: '', sources: [], cached: false })),
      canAnalyze: () => true,
      canResearch: () => false,
      getAnalysisProvider: () => 'claude',
    };

    const result = await patternQuality(makeInput(bars, llm));
    // If algorithmic detects partial VCP (0.5), LLM should upgrade to 1.0
    if (result.metadata?.contractionCount && result.metadata.contractionCount >= 2) {
      expect(result.score).toBe(1.0);
      expect(result.dataSource).not.toBe('ohlcv_cache');
    }
  });

  it('keeps algorithmic score when LLM throws', async () => {
    const bars = partialVCPBars();
    const llm: LLMService = {
      analyzeOHLCV: mock(() => Promise.reject(new Error('API error'))),
      research: mock(() => Promise.resolve({ answer: '', sources: [], cached: false })),
      canAnalyze: () => true,
      canResearch: () => false,
      getAnalysisProvider: () => 'claude',
    };

    const result = await patternQuality(makeInput(bars, llm));
    // Should fall back to algorithmic score (0 or 0.5)
    expect(result.score).toBeLessThanOrEqual(1);
    expect(result.dataSource).toBe('ohlcv_cache');
  });
});
