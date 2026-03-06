import { describe, it, expect } from 'vitest';
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
      db.prepare(sql).run(...params);
    },
    execMulti(sql: string) {
      db.exec(sql);
    },
    query<T>(sql: string, params: unknown[] = []): T[] {
      return db.prepare(sql).all(...params) as T[];
    },
    queryOne<T>(sql: string, params: unknown[] = []): T | null {
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

describe('ScoringEngine', () => {
  it('scores a symbol and returns PARTIAL result', async () => {
    const provider = new MockProvider();
    const db = createTestAdapter();
    const engine = new ScoringEngine(provider, db);

    const ctx = createScoringContext(['RELIANCE']);
    const result = await engine.scoreSymbol('RELIANCE', '2885', ctx);

    expect(result.symbol).toBe('RELIANCE');
    expect(result.status).toBe('PARTIAL');
    expect(result.factors.length).toBe(8); // 8 algorithmic factors
    expect(result.algorithmicScore).toBeGreaterThanOrEqual(0);
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
});

describe('FactorRegistry', () => {
  it('creates default registry with 13 factors', () => {
    const registry = createDefaultRegistry();
    expect(registry.getAll()).toHaveLength(13);
  });

  it('separates algorithmic and discretionary factors', () => {
    const registry = createDefaultRegistry();
    expect(registry.getAlgorithmic()).toHaveLength(8);
    expect(registry.getDiscretionary()).toHaveLength(5);
  });

  it('calculates max score from enabled factors', () => {
    const registry = createDefaultRegistry();
    // 8 algorithmic (8 × 1) + 4 discretionary (4 × 1) + 1 HVQ (0.5) = 12.5
    expect(registry.maxScore()).toBe(12.5);
  });

  it('adjusts threshold when factors disabled', () => {
    const registry = createDefaultRegistry();
    // Disable 2 binary factors → max drops from 12.5 to 10.5
    registry.disable('ep_catalyst');
    registry.disable('ipo_recency');
    expect(registry.maxScore()).toBe(10.5);

    // BULL threshold 8.0 → adjusted = round(8.0 * (10.5/12.5) * 2) / 2
    const adjusted = registry.adjustedThreshold(8.0);
    expect(adjusted).toBe(6.5);
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
