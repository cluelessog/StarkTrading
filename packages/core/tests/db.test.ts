// db.test.ts uses bun:sqlite directly (aliased to better-sqlite3 shim in vitest.config.ts)
// This tests schema correctness without going through BunSQLiteAdapter.
import { Database } from 'bun:sqlite';
import { describe, it, expect } from 'vitest';
import { MIGRATIONS } from '../src/db/schema.js';

function createInMemoryDb(): InstanceType<typeof Database> {
  const db = new Database(':memory:');
  for (const migration of MIGRATIONS) {
    db.exec(migration.sql);
  }
  return db;
}

describe('Schema', () => {
  it('creates all tables without errors', () => {
    expect(() => createInMemoryDb()).not.toThrow();
  });

  it('has expected tables', () => {
    const db = createInMemoryDb();
    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
      .all() as { name: string }[];
    const tableNames = tables.map((t) => t.name);
    expect(tableNames).toContain('watchlists');
    expect(tableNames).toContain('watchlist_stocks');
    expect(tableNames).toContain('ohlcv_cache');
    expect(tableNames).toContain('stock_scores');
    expect(tableNames).toContain('mbi_daily');
    expect(tableNames).toContain('trade_journal');
    expect(tableNames).toContain('positions');
    db.close();
  });
});

describe('watchlists table roundtrip', () => {
  it('inserts and queries a watchlist', () => {
    const db = createInMemoryDb();
    db.prepare("INSERT INTO watchlists (name) VALUES (?)").run('My Watchlist');
    const row = db
      .prepare("SELECT * FROM watchlists WHERE name = ?")
      .get('My Watchlist') as { id: number; name: string; created_at: string };
    expect(row).toBeDefined();
    expect(row.name).toBe('My Watchlist');
    expect(row.id).toBeGreaterThan(0);
    db.close();
  });
});

describe('stock_scores table roundtrip', () => {
  it('inserts and queries a stock score', () => {
    const db = createInMemoryDb();
    db.prepare(`
      INSERT INTO stock_scores (symbol, token, name, scoring_session_id, status, algorithmic_score, discretionary_score, total_score, max_possible_score, override_count, data_freshness)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('RELIANCE', '2885', 'Reliance Industries', 'sess-001', 'COMPLETE', 7.5, 2.0, 9.5, 12.5, 0, 'fresh');

    const row = db
      .prepare("SELECT * FROM stock_scores WHERE symbol = ? AND scoring_session_id = ?")
      .get('RELIANCE', 'sess-001') as { symbol: string; total_score: number; status: string };
    expect(row).toBeDefined();
    expect(row.symbol).toBe('RELIANCE');
    expect(row.total_score).toBe(9.5);
    expect(row.status).toBe('COMPLETE');
    db.close();
  });
});

describe('mbi_daily composite key', () => {
  it('allows multiple rows for same date with different captured_at', () => {
    const db = createInMemoryDb();
    db.prepare(`
      INSERT INTO mbi_daily (date, captured_at, source, data_freshness) VALUES (?, ?, ?, ?)
    `).run('2026-03-05', 'eod', 'sheet', 'fresh');
    db.prepare(`
      INSERT INTO mbi_daily (date, captured_at, source, data_freshness) VALUES (?, ?, ?, ?)
    `).run('2026-03-05', 'intraday', 'chartink', 'fresh');

    const rows = db
      .prepare("SELECT * FROM mbi_daily WHERE date = ? ORDER BY captured_at")
      .all('2026-03-05') as { date: string; captured_at: string }[];
    expect(rows).toHaveLength(2);
    expect(rows[0].captured_at).toBe('eod');
    expect(rows[1].captured_at).toBe('intraday');
    db.close();
  });
});

describe('trade_journal trade_type default', () => {
  it('has trade_type column with default swing', () => {
    const db = createInMemoryDb();
    db.prepare(`
      INSERT INTO trade_journal (symbol, entry_date, entry_price, shares)
      VALUES (?, ?, ?, ?)
    `).run('INFY', '2026-03-05', 1500.0, 10);

    const row = db
      .prepare("SELECT trade_type FROM trade_journal WHERE symbol = ?")
      .get('INFY') as { trade_type: string };
    expect(row).toBeDefined();
    expect(row.trade_type).toBe('swing');
    db.close();
  });
});

describe('positions trade_type default', () => {
  it('has trade_type column with default swing', () => {
    const db = createInMemoryDb();
    db.prepare(`
      INSERT INTO positions (symbol, entry_date, entry_price, shares)
      VALUES (?, ?, ?, ?)
    `).run('TCS', '2026-03-05', 3200.0, 5);

    const row = db
      .prepare("SELECT trade_type FROM positions WHERE symbol = ?")
      .get('TCS') as { trade_type: string };
    expect(row).toBeDefined();
    expect(row.trade_type).toBe('swing');
    db.close();
  });
});
