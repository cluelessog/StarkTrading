// db.test.ts uses bun:sqlite directly (aliased to better-sqlite3 shim in vitest.config.ts)
// This tests schema correctness without going through BunSQLiteAdapter.
import { Database } from 'bun:sqlite';
import { describe, it, expect } from 'vitest';
import { MIGRATIONS, SCHEMA_VERSION } from '../src/db/schema.js';
import { Queries } from '../src/db/queries.js';

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

// ---------------------------------------------------------------------------
// Migration v2 tests
// ---------------------------------------------------------------------------

describe('Schema version', () => {
  it('SCHEMA_VERSION is 2', () => {
    expect(SCHEMA_VERSION).toBe(2);
  });
});

describe('Migration v2 tables', () => {
  it('creates automation_log and chat_sessions tables', () => {
    const db = createInMemoryDb();
    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
      .all() as { name: string }[];
    const tableNames = tables.map((t) => t.name);
    expect(tableNames).toContain('automation_log');
    expect(tableNames).toContain('chat_sessions');
    db.close();
  });

  it('fresh DB has 17 tables (15 v1 + 2 v2)', () => {
    const db = createInMemoryDb();
    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
      .all() as { name: string }[];
    expect(tables.length).toBe(17);
    db.close();
  });

  it('v1 DB migrates cleanly to v2', () => {
    const db = new Database(':memory:');
    // Apply only v1 migration
    db.exec(MIGRATIONS[0].sql);
    const tablesV1 = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`)
      .all() as { name: string }[];
    expect(tablesV1.map((t) => t.name)).not.toContain('automation_log');

    // Apply v2 migration (uses CREATE TABLE IF NOT EXISTS)
    db.exec(MIGRATIONS[1].sql);
    const tablesV2 = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`)
      .all() as { name: string }[];
    expect(tablesV2.map((t) => t.name)).toContain('automation_log');
    expect(tablesV2.map((t) => t.name)).toContain('chat_sessions');
    db.close();
  });
});

describe('busy_timeout pragma', () => {
  it('can be set to 5000 and queried back', () => {
    const db = new Database(':memory:');
    db.exec('PRAGMA busy_timeout = 5000;');
    const row = db.prepare('PRAGMA busy_timeout').get() as { timeout: number };
    expect(row.timeout).toBe(5000);
    db.close();
  });
});

// ---------------------------------------------------------------------------
// Queries: chat sessions + automation log
// ---------------------------------------------------------------------------

function createTestAdapter(db: InstanceType<typeof Database>) {
  return {
    execute(sql: string, params: unknown[] = []) { db.prepare(sql).run(...(params as [string])); },
    execMulti(sql: string) { db.exec(sql); },
    query<T>(sql: string, params: unknown[] = []): T[] { return db.prepare(sql).all(...(params as [string])) as T[]; },
    queryOne<T>(sql: string, params: unknown[] = []): T | null { return (db.prepare(sql).get(...(params as [string])) as T | undefined) ?? null; },
    transaction<T>(fn: () => T): T { return db.transaction(fn)() as T; },
    close() { db.close(); },
  };
}

describe('Queries: chat sessions', () => {
  it('insertChatMessage + getRecentChatMessages round-trip', () => {
    const db = createInMemoryDb();
    const adapter = createTestAdapter(db);
    const queries = new Queries(adapter);

    queries.insertChatMessage('chat-1', 'telegram', 'user', 'Hello');
    queries.insertChatMessage('chat-1', 'telegram', 'assistant', 'Hi there');

    const messages = queries.getRecentChatMessages('chat-1');
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('user');
    expect(messages[0].message).toBe('Hello');
    expect(messages[1].role).toBe('assistant');
    expect(messages[1].message).toBe('Hi there');
    db.close();
  });

  it('getRecentChatMessages returns ASC order', () => {
    const db = createInMemoryDb();
    const adapter = createTestAdapter(db);
    const queries = new Queries(adapter);

    queries.insertChatMessage('chat-2', 'telegram', 'user', 'First');
    queries.insertChatMessage('chat-2', 'telegram', 'user', 'Second');
    queries.insertChatMessage('chat-2', 'telegram', 'user', 'Third');

    const messages = queries.getRecentChatMessages('chat-2');
    expect(messages[0].message).toBe('First');
    expect(messages[2].message).toBe('Third');
    db.close();
  });

  it('trimChatHistory keeps only the last N messages', () => {
    const db = createInMemoryDb();
    const adapter = createTestAdapter(db);
    const queries = new Queries(adapter);

    for (let i = 1; i <= 15; i++) {
      queries.insertChatMessage('chat-3', 'telegram', 'user', `Message ${i}`);
    }

    queries.trimChatHistory('chat-3', 10);
    const messages = queries.getRecentChatMessages('chat-3', 100);
    expect(messages).toHaveLength(10);
    expect(messages[0].message).toBe('Message 6');
    expect(messages[9].message).toBe('Message 15');
    db.close();
  });
});

describe('Queries: automation log', () => {
  it('insertAutomationLog + getAutomationLogs round-trip', () => {
    const db = createInMemoryDb();
    const adapter = createTestAdapter(db);
    const queries = new Queries(adapter);

    queries.insertAutomationLog('sync', 'success', 'Synced 2 positions', 'scheduler');
    queries.insertAutomationLog('evening', 'failure', 'API timeout', 'manual');

    const logs = queries.getAutomationLogs();
    expect(logs).toHaveLength(2);
    // DESC order: newest first
    expect(logs[0].action).toBe('evening');
    expect(logs[0].status).toBe('failure');
    expect(logs[0].triggeredBy).toBe('manual');
    expect(logs[1].action).toBe('sync');
    expect(logs[1].status).toBe('success');
    db.close();
  });

  it('insertAutomationLog defaults triggeredBy to scheduler', () => {
    const db = createInMemoryDb();
    const adapter = createTestAdapter(db);
    const queries = new Queries(adapter);

    queries.insertAutomationLog('morning', 'skipped');
    const logs = queries.getAutomationLogs();
    expect(logs[0].triggeredBy).toBe('scheduler');
    db.close();
  });
});
