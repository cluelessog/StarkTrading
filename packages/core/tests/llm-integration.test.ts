import { describe, it, expect, mock } from 'bun:test';
import { Database } from 'bun:sqlite';
import { ScoringEngine } from '../src/scoring/engine.js';
import { MockProvider } from '../src/api/mock-provider.js';
import { createScoringContext } from '../src/scoring/context.js';
import { MIGRATIONS } from '../src/db/schema.js';
import type { DatabaseAdapter } from '../src/db/adapter.js';
import type { LLMService } from '../src/llm/index.js';

function createTestAdapter(): DatabaseAdapter {
  const db = new Database(':memory:');
  for (const migration of MIGRATIONS) {
    db.exec(migration.sql);
  }
  return {
    execute(sql: string, params: any[] = []) {
      db.prepare(sql).run(...params);
    },
    execMulti(sql: string) {
      db.exec(sql);
    },
    query<T>(sql: string, params: any[] = []): T[] {
      return db.prepare(sql).all(...params) as T[];
    },
    queryOne<T>(sql: string, params: any[] = []): T | null {
      return (db.prepare(sql).get(...params) as T | undefined) ?? null;
    },
    transaction<T>(fn: () => T): T {
      return db.transaction(fn)() as T;
    },
    close() {
      db.close();
    },
  };
}

function createMockLLMService(): LLMService {
  return {
    analyzeOHLCV: mock(() =>
      Promise.resolve({
        score: 1,
        reasoning: 'Mock LLM analysis: positive',
        confidence: 0.9,
        cached: false,
      }),
    ),
    research: mock(() =>
      Promise.resolve({
        answer: 'No significant news found',
        sources: [],
        cached: false,
      }),
    ),
    complete: async () => '',
    canAnalyze: () => true,
    canResearch: () => true,
    canComplete: () => false,
    getAnalysisProvider: () => 'claude',
  };
}

describe('ScoringEngine integration', () => {
  it('scores all 13 factors with LLM service and returns PARTIAL (no review)', async () => {
    const provider = new MockProvider();
    const db = createTestAdapter();
    const llm = createMockLLMService();
    const engine = new ScoringEngine(provider, db, undefined, llm);

    const ctx = createScoringContext(['RELIANCE']);
    const result = await engine.scoreSymbol('RELIANCE', '2885', ctx);

    expect(result.status).toBe('PARTIAL');
    expect(result.factors).toHaveLength(13);
    expect(result.totalScore).toBe(result.algorithmicScore + result.discretionaryScore);
    expect(result.maxPossibleScore).toBe(13);

    // Verify all factor IDs are present
    const factorIds = result.factors.map((f) => f.factorId);
    expect(factorIds).toContain('ep_catalyst');
    expect(factorIds).toContain('linearity');
    expect(factorIds).toContain('not_pivot_cutter');
    expect(factorIds).toContain('aoi');
    expect(factorIds).toContain('hve_hvy');
    expect(factorIds).toContain('hvq_2_5');

    db.close();
  });

  it('scores all 13 factors without LLM and returns PARTIAL (no review)', async () => {
    const provider = new MockProvider();
    const db = createTestAdapter();
    // No LLM service — semi-discretionary factors use algorithmic fallback
    const engine = new ScoringEngine(provider, db);

    const ctx = createScoringContext(['TCS']);
    const result = await engine.scoreSymbol('TCS', '11536', ctx);

    expect(result.status).toBe('PARTIAL');
    expect(result.factors).toHaveLength(13);
    // Without LLM, borderline/ambiguous cases score 0
    expect(result.algorithmicScore).toBeGreaterThanOrEqual(0);
    expect(result.discretionaryScore).toBeGreaterThanOrEqual(0);

    db.close();
  });

  it('stores all 13 factor columns in DB via scoreBatch', async () => {
    const provider = new MockProvider();
    const db = createTestAdapter();
    const engine = new ScoringEngine(provider, db);

    const { results } = await engine.scoreBatch([
      { symbol: 'RELIANCE', token: '2885', name: 'Reliance Industries' },
    ]);

    // Verify in-memory result status
    expect(results[0].status).toBe('PARTIAL');

    const row = db.queryOne<{
      symbol: string;
      status: string;
      total_score: number;
      linearity: number | null;
      not_pivot_cutter: number | null;
      aoi: number | null;
      hve_hvy: number | null;
      hvq_2_5: number | null;
    }>(
      `SELECT symbol, status, total_score, linearity, not_pivot_cutter, aoi, hve_hvy, hvq_2_5
       FROM stock_scores WHERE symbol = ? ORDER BY id DESC LIMIT 1`,
      ['RELIANCE'],
    );

    expect(row).not.toBeNull();
    expect(row!.status).toBe('PARTIAL');
    expect(typeof row!.linearity).toBe('number');
    expect(typeof row!.not_pivot_cutter).toBe('number');
    expect(typeof row!.aoi).toBe('number');
    expect(typeof row!.hve_hvy).toBe('number');
    expect(typeof row!.hvq_2_5).toBe('number');

    db.close();
  });

  it('gracefully handles LLM errors without breaking scoring', async () => {
    const provider = new MockProvider();
    const db = createTestAdapter();
    const failingLLM: LLMService = {
      analyzeOHLCV: mock(() => Promise.reject(new Error('LLM API down'))),
      research: mock(() => Promise.reject(new Error('LLM API down'))),
      complete: async () => '',
      canAnalyze: () => true,
      canResearch: () => true,
      canComplete: () => false,
      getAnalysisProvider: () => 'claude',
    };
    const engine = new ScoringEngine(provider, db, undefined, failingLLM);

    const ctx = createScoringContext(['INFY']);
    const result = await engine.scoreSymbol('INFY', '1594', ctx);

    // Should still produce PARTIAL — factors fall back gracefully but not reviewed
    expect(result.status).toBe('PARTIAL');
    expect(result.factors).toHaveLength(13);

    db.close();
  });
});
