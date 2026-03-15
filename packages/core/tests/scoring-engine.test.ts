import { describe, it, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { MIGRATIONS } from '../src/db/schema.js';
import { MockProvider } from '../src/api/mock-provider.js';
import { ScoringEngine } from '../src/scoring/engine.js';
import { createScoringContext } from '../src/scoring/context.js';
import { createDefaultRegistry } from '../src/scoring/registry.js';

// In-memory adapter matching DatabaseAdapter interface
function createTestAdapter() {
  const db = new Database(':memory:');
  for (const m of MIGRATIONS) db.exec(m.sql);

  return {
    execute(sql: string, params: unknown[] = []) {
      db.prepare(sql).run(...(params as [string]));
    },
    execMulti(sql: string) {
      db.exec(sql);
    },
    query<T>(sql: string, params: unknown[] = []): T[] {
      return db.prepare(sql).all(...(params as [string])) as T[];
    },
    queryOne<T>(sql: string, params: unknown[] = []): T | null {
      return (db.prepare(sql).get(...(params as [string])) as T | undefined) ?? null;
    },
    transaction<T>(fn: () => T): T {
      return db.transaction(fn)() as T;
    },
    close() {
      db.close();
    },
  };
}

describe('ScoringEngine', () => {
  it('scores a symbol and returns PARTIAL result (no review)', async () => {
    const provider = new MockProvider();
    const db = createTestAdapter();
    const engine = new ScoringEngine(provider, db);

    const ctx = createScoringContext(['RELIANCE']);
    const result = await engine.scoreSymbol('RELIANCE', '2885', ctx);

    expect(result.symbol).toBe('RELIANCE');
    expect(result.status).toBe('PARTIAL');
    expect(result.factors.length).toBe(13); // 7 algorithmic + 6 semi-discretionary factors
    expect(result.algorithmicScore).toBeGreaterThanOrEqual(0);
    expect(result.discretionaryScore).toBeGreaterThanOrEqual(0);
    expect(result.totalScore).toBe(result.algorithmicScore + result.discretionaryScore);
    expect(result.maxPossibleScore).toBeGreaterThan(0);

    // Each factor has required fields
    for (const f of result.factors) {
      expect(f.factorId).toBeTruthy();
      expect(f.factorName).toBeTruthy();
      expect(typeof f.score).toBe('number');
      expect(typeof f.maxScore).toBe('number');
      expect(f.reasoning).toBeTruthy();
      expect(f.dataSource).toBeTruthy();
    }

    db.close();
  });

  it('scores a batch and stores in DB', async () => {
    const provider = new MockProvider();
    const db = createTestAdapter();
    const engine = new ScoringEngine(provider, db);

    const { results, context } = await engine.scoreBatch([
      { symbol: 'RELIANCE', token: '2885', name: 'Reliance Industries' },
      { symbol: 'TCS', token: '11536', name: 'TCS Ltd' },
    ]);

    expect(results).toHaveLength(2);
    expect(context.completedAt).toBeDefined();
    expect(results[0].symbol).toBe('RELIANCE');
    expect(results[1].symbol).toBe('TCS');

    // Check DB storage
    const rows = db.query<{ symbol: string; status: string }>(
      'SELECT symbol, status FROM stock_scores ORDER BY symbol',
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].symbol).toBe('RELIANCE');
    expect(rows[0].status).toBe('PARTIAL');

    db.close();
  });

  it('returns COMPLETE when all semi-discretionary factors reviewed', async () => {
    const provider = new MockProvider();
    const db = createTestAdapter();
    const engine = new ScoringEngine(provider, db);

    const ctx = createScoringContext(['RELIANCE']);
    const allSemiDisc = engine.getSemiDiscretionaryIds();
    const result = await engine.scoreSymbol('RELIANCE', '2885', ctx, allSemiDisc);

    expect(result.status).toBe('COMPLETE');
    expect(result.factors).toHaveLength(13);

    db.close();
  });

  it('includes pattern_quality in semi-discretionary IDs', () => {
    const provider = new MockProvider();
    const db = createTestAdapter();
    const engine = new ScoringEngine(provider, db);

    const semiDiscIds = engine.getSemiDiscretionaryIds();
    expect(semiDiscIds.has('pattern_quality')).toBe(true);
    expect(semiDiscIds.has('linearity')).toBe(true);
    expect(semiDiscIds.has('not_pivot_cutter')).toBe(true);
    expect(semiDiscIds.has('aoi')).toBe(true);
    expect(semiDiscIds.has('hve_hvy')).toBe(true);
    expect(semiDiscIds.has('hvq_2_5')).toBe(true);
    expect(semiDiscIds.size).toBe(6);

    db.close();
  });
});

describe('FactorRegistry', () => {
  it('creates default registry with 13 factors', () => {
    const registry = createDefaultRegistry();
    expect(registry.getAll()).toHaveLength(13);
  });

  it('separates algorithmic and discretionary factors', () => {
    const registry = createDefaultRegistry();
    expect(registry.getAlgorithmic()).toHaveLength(13);
    expect(registry.getDiscretionary()).toHaveLength(0);
  });

  it('calculates max score from enabled factors', () => {
    const registry = createDefaultRegistry();
    // 7 algorithmic (7 × 1) + 6 semi-discretionary (6 × 1) = 13
    expect(registry.maxScore()).toBe(13);
  });

  it('adjusts threshold when factors disabled', () => {
    const registry = createDefaultRegistry();
    // Disable 2 binary factors → max drops from 13 to 11
    registry.disable('ep_catalyst');
    registry.disable('ipo_recency');
    expect(registry.maxScore()).toBe(11);

    // BULL threshold 8.0 → adjusted = round(8.0 * (11/13) * 2) / 2
    const adjusted = registry.adjustedThreshold(8.0);
    expect(adjusted).toBe(7.0);
  });

  it('enables and disables factors', () => {
    const registry = createDefaultRegistry();
    registry.disable('high_rs');
    expect(registry.get('high_rs')!.enabled).toBe(false);
    expect(registry.getEnabled()).toHaveLength(12);

    registry.enable('high_rs');
    expect(registry.get('high_rs')!.enabled).toBe(true);
    expect(registry.getEnabled()).toHaveLength(13);
  });
});
