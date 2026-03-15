import { describe, it, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { MIGRATIONS } from '../src/db/schema.js';
import { generateFocusList } from '../src/mbi/focus-list.js';
import { createDefaultRegistry } from '../src/scoring/registry.js';

function createTestDb() {
  const db = new Database(':memory:');
  for (const m of MIGRATIONS) db.exec(m.sql);
  return {
    execute(sql: string, params: unknown[] = []) {
      db.prepare(sql).run(...(params as [string]));
    },
    execMulti(sql: string) { db.exec(sql); },
    query<T>(sql: string, params: unknown[] = []): T[] {
      return db.prepare(sql).all(...(params as [string])) as T[];
    },
    queryOne<T>(sql: string, params: unknown[] = []): T | null {
      return (db.prepare(sql).get(...(params as [string])) as T | undefined) ?? null;
    },
    transaction<T>(fn: () => T): T { return db.transaction(fn)() as T; },
    close() { db.close(); },
  };
}

function insertScore(db: ReturnType<typeof createTestDb>, symbol: string, total: number, status: string) {
  db.execute(
    `INSERT INTO stock_scores (symbol, token, name, scoring_session_id, status,
       algorithmic_score, discretionary_score, total_score, max_possible_score, override_count, data_freshness)
     VALUES (?, ?, ?, 'test', ?, ?, ?, ?, 12.5, 0, 'fresh')`,
    [symbol, '0', symbol, status, total * 0.6, total * 0.4, total],
  );
}

describe('generateFocusList', () => {
  it('returns COMPLETE stocks above threshold in BULL regime', () => {
    const db = createTestDb();
    const registry = createDefaultRegistry();

    insertScore(db, 'HIGH_SCORE', 10, 'COMPLETE');
    insertScore(db, 'MID_SCORE', 8.5, 'COMPLETE');
    insertScore(db, 'LOW_SCORE', 6, 'COMPLETE');
    insertScore(db, 'PARTIAL_HIGH', 10, 'PARTIAL'); // should be excluded

    const result = generateFocusList(db, 'BULL', registry);
    expect(result.regime).toBe('BULL');
    expect(result.threshold).toBe(8); // 8.0 for BULL
    expect(result.stocks.length).toBe(2); // HIGH_SCORE and MID_SCORE
    expect(result.stocks[0].symbol).toBe('HIGH_SCORE');

    db.close();
  });

  it('returns empty list in BEAR regime', () => {
    const db = createTestDb();
    const registry = createDefaultRegistry();

    insertScore(db, 'HIGH', 11, 'COMPLETE');

    const result = generateFocusList(db, 'BEAR', registry);
    expect(result.stocks).toHaveLength(0);
    expect(result.maxStocks).toBe(0);

    db.close();
  });

  it('adjusts threshold when factors disabled', () => {
    const db = createTestDb();
    const registry = createDefaultRegistry();
    registry.disable('ep_catalyst');
    registry.disable('ipo_recency');

    insertScore(db, 'STOCK_A', 7, 'COMPLETE');

    const result = generateFocusList(db, 'BULL', registry);
    // Adjusted threshold: 8.0 * (11/13) = 6.77 → 7.0
    expect(result.threshold).toBe(7.0);
    expect(result.stocks.length).toBe(1);

    db.close();
  });

  it('includes PARTIAL stocks when includePartial is true', () => {
    const db = createTestDb();
    const registry = createDefaultRegistry();

    insertScore(db, 'COMPLETE_HIGH', 10, 'COMPLETE');
    insertScore(db, 'PARTIAL_HIGH', 9.5, 'PARTIAL');
    insertScore(db, 'PARTIAL_LOW', 6, 'PARTIAL');

    // Default: only COMPLETE
    const result = generateFocusList(db, 'BULL', registry);
    expect(result.stocks.length).toBe(1);
    expect(result.stocks[0].symbol).toBe('COMPLETE_HIGH');

    // With includePartial: both COMPLETE and qualifying PARTIAL
    const resultWithPartial = generateFocusList(db, 'BULL', registry, { includePartial: true });
    expect(resultWithPartial.stocks.length).toBe(2);
    expect(resultWithPartial.stocks[0].symbol).toBe('COMPLETE_HIGH');
    expect(resultWithPartial.stocks[1].symbol).toBe('PARTIAL_HIGH');

    db.close();
  });

  it('limits to maxStocks per regime', () => {
    const db = createTestDb();
    const registry = createDefaultRegistry();

    for (let i = 0; i < 10; i++) {
      insertScore(db, `STOCK_${i}`, 9 + i * 0.1, 'COMPLETE');
    }

    const result = generateFocusList(db, 'CHOPPY', registry);
    expect(result.stocks.length).toBeLessThanOrEqual(2); // CHOPPY max = 2

    db.close();
  });

  it('uses custom scoreThresholds when provided', () => {
    const db = createTestDb();
    const registry = createDefaultRegistry();

    insertScore(db, 'STOCK_A', 7, 'COMPLETE');
    insertScore(db, 'STOCK_B', 5, 'COMPLETE');

    // Default BULL threshold is 8.0 — neither stock qualifies
    const defaultResult = generateFocusList(db, 'BULL', registry);
    expect(defaultResult.stocks.length).toBe(0);

    // Custom threshold lowers BULL to 6.0 — STOCK_A qualifies
    const customResult = generateFocusList(db, 'BULL', registry, {
      scoreThresholds: { BULL: 6.0 },
    });
    expect(customResult.stocks.length).toBe(1);
    expect(customResult.stocks[0].symbol).toBe('STOCK_A');

    db.close();
  });
});
