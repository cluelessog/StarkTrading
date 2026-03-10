import { describe, it, expect, mock } from 'bun:test';
import { epCatalyst } from '../src/scoring/factors/ep-catalyst.js';
import type { FactorInput } from '../src/scoring/registry.js';
import type { OHLCVBar } from '../src/models/intervals.js';
import type { LLMService } from '../src/llm/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBar(date: string, open: number, close: number, volume = 100000): OHLCVBar {
  return {
    timestamp: date,
    date,
    open,
    high: Math.max(open, close) + 1,
    low: Math.min(open, close) - 1,
    close,
    volume,
  };
}

function makeInput(dailyBars: OHLCVBar[], llmService?: LLMService): FactorInput {
  return {
    symbol: 'RELIANCE',
    token: '2885',
    dailyBars,
    provider: {} as FactorInput['provider'],
    context: { sessionId: 'test', startTime: Date.now(), symbols: ['RELIANCE'], errors: [], completedSymbols: 0, totalSymbols: 1 },
    llmService,
  };
}

function consecutiveBars(n: number, basePrice = 100): OHLCVBar[] {
  const bars: OHLCVBar[] = [];
  for (let i = 0; i < n; i++) {
    // Use consecutive weekday timestamps
    const day = i + 1;
    const month = Math.floor(day / 28) + 1;
    const d = `2026-${String(month).padStart(2, '0')}-${String(((day - 1) % 28) + 1).padStart(2, '0')}`;
    bars.push(makeBar(d, basePrice, basePrice + 0.5));
  }
  return bars;
}

function mockLLMService(researchAnswer: string): LLMService {
  return {
    analyzeOHLCV: mock(() => Promise.resolve({ score: 0, reasoning: '', confidence: 0, cached: false })),
    research: mock(() => Promise.resolve({ answer: researchAnswer, sources: [], cached: false })),
    canAnalyze: () => true,
    canResearch: () => true,
    getAnalysisProvider: () => 'claude',
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('epCatalyst LLM-enhanced', () => {
  it('still works without LLM (gap-only logic)', async () => {
    const bars = consecutiveBars(10);
    const result = await epCatalyst(makeInput(bars));
    expect(result.score).toBe(0);
    expect(result.dataSource).toBe('ohlcv_cache');
  });

  it('detects LLM catalyst when no gap present', async () => {
    const bars = consecutiveBars(10);
    const llm = mockLLMService('RELIANCE reported strong earnings beat in Q3 with surprise revenue growth');
    const result = await epCatalyst(makeInput(bars, llm));
    expect(result.score).toBe(1);
    expect(result.dataSource).toBe('perplexity');
    expect(result.metadata?.llmCatalyst).toBe(true);
  });

  it('returns 0 when LLM finds no catalyst', async () => {
    const bars = consecutiveBars(10);
    const llm = mockLLMService('No significant news or events for RELIANCE in the last 5 trading days.');
    const result = await epCatalyst(makeInput(bars, llm));
    expect(result.score).toBe(0);
    expect(result.dataSource).toBe('ohlcv_cache');
  });

  it('filters corporate action gaps via LLM', async () => {
    // Create a gap >8%
    const bars = consecutiveBars(8);
    bars.push(makeBar('2026-01-09', bars[bars.length - 1].close * 1.1, bars[bars.length - 1].close * 1.12));
    const llm = mockLLMService('RELIANCE had a 1:1 bonus issue effective January 8th, resulting in a stock split.');
    const result = await epCatalyst(makeInput(bars, llm));
    expect(result.score).toBe(0);
    expect(result.metadata?.corporateAction).toBe(true);
  });

  it('gracefully falls back when LLM throws', async () => {
    const bars = consecutiveBars(10);
    const llm: LLMService = {
      analyzeOHLCV: mock(() => Promise.reject(new Error('API error'))),
      research: mock(() => Promise.reject(new Error('API error'))),
      canAnalyze: () => true,
      canResearch: () => true,
      getAnalysisProvider: () => 'claude',
    };
    const result = await epCatalyst(makeInput(bars, llm));
    expect(result.score).toBe(0);
    expect(result.dataSource).toBe('ohlcv_cache');
  });
});
