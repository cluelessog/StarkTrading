import { describe, it, expect } from 'vitest';
import { Database } from 'bun:sqlite';
import { MIGRATIONS } from '../src/db/schema.js';
import { TradeManager } from '../src/journal/trade-manager.js';
import { generatePerformanceReport } from '../src/journal/performance.js';

function createTestDb() {
  const db = new Database(':memory:');
  for (const m of MIGRATIONS) db.exec(m.sql);
  return {
    execute(sql: string, params: unknown[] = []) { db.prepare(sql).run(...(params as [string])); },
    execMulti(sql: string) { db.exec(sql); },
    query<T>(sql: string, params: unknown[] = []): T[] { return db.prepare(sql).all(...(params as [string])) as T[]; },
    queryOne<T>(sql: string, params: unknown[] = []): T | null { return (db.prepare(sql).get(...(params as [string])) as T | undefined) ?? null; },
    transaction<T>(fn: () => T): T { return db.transaction(fn)() as T; },
    close() { db.close(); },
  };
}

describe('generatePerformanceReport', () => {
  it('returns insufficient data flag with no trades', () => {
    const db = createTestDb();
    const report = generatePerformanceReport(db);

    expect(report.overall.totalTrades).toBe(0);
    expect(report.overall.sufficientData).toBe(false);
    expect(report.overall.minTradesNeeded).toBe(20);

    db.close();
  });

  it('calculates basic stats from closed trades', () => {
    const db = createTestDb();
    const mgr = new TradeManager(db);

    // 2 wins, 1 loss
    mgr.entry({ symbol: 'W1', entryPrice: 100, shares: 100, stopPrice: 90, conviction: 'HIGH' });
    mgr.exit({ symbol: 'W1', exitPrice: 120, exitReason: 'TARGET' }); // +2000

    mgr.entry({ symbol: 'W2', entryPrice: 200, shares: 50, stopPrice: 180, conviction: 'MEDIUM' });
    mgr.exit({ symbol: 'W2', exitPrice: 230, exitReason: 'TARGET' }); // +1500

    mgr.entry({ symbol: 'L1', entryPrice: 150, shares: 100, stopPrice: 140, conviction: 'LOW' });
    mgr.exit({ symbol: 'L1', exitPrice: 140, exitReason: 'STOPPED' }); // -1000

    const report = generatePerformanceReport(db);
    const s = report.overall;

    expect(s.closedTrades).toBe(3);
    expect(s.wins).toBe(2);
    expect(s.losses).toBe(1);
    expect(s.winRate).toBeCloseTo(66.7, 0);
    expect(s.totalPnl).toBe(2500); // 2000+1500-1000
    expect(s.sufficientData).toBe(false);

    db.close();
  });

  it('includes open trades in total count', () => {
    const db = createTestDb();
    const mgr = new TradeManager(db);

    mgr.entry({ symbol: 'OPEN1', entryPrice: 100, shares: 100, stopPrice: 90, conviction: 'HIGH' });
    mgr.entry({ symbol: 'CLOSED1', entryPrice: 100, shares: 100, stopPrice: 90, conviction: 'HIGH' });
    mgr.exit({ symbol: 'CLOSED1', exitPrice: 110, exitReason: 'TARGET' });

    const report = generatePerformanceReport(db);
    expect(report.overall.totalTrades).toBe(2);
    expect(report.overall.openTrades).toBe(1);
    expect(report.overall.closedTrades).toBe(1);

    db.close();
  });

  it('groups by score range', () => {
    const db = createTestDb();

    // Insert trades directly with scores
    for (let i = 0; i < 5; i++) {
      db.execute(
        `INSERT INTO trade_journal (symbol, trade_type, entry_date, entry_price, shares, stop_price, risk_amount,
           exit_date, exit_price, exit_reason, pnl, r_multiple, hold_days, score_at_entry, conviction, status)
         VALUES (?, 'swing', '2026-01-01', 100, 100, 90, 1000,
           '2026-01-10', 120, 'TARGET', 2000, 2, 9, ?, 'HIGH', 'CLOSED')`,
        [`W${i}`, 9 + i * 0.1]
      );
    }
    for (let i = 0; i < 3; i++) {
      db.execute(
        `INSERT INTO trade_journal (symbol, trade_type, entry_date, entry_price, shares, stop_price, risk_amount,
           exit_date, exit_price, exit_reason, pnl, r_multiple, hold_days, score_at_entry, conviction, status)
         VALUES (?, 'swing', '2026-01-01', 100, 100, 90, 1000,
           '2026-01-10', 80, 'STOPPED', -2000, -2, 9, ?, 'LOW', 'CLOSED')`,
        [`L${i}`, 6 + i * 0.5]
      );
    }

    const report = generatePerformanceReport(db);
    expect(report.byScoreRange.length).toBeGreaterThan(0);

    // Score 9+ should have 100% win rate
    const highRange = report.byScoreRange.find(e => e.label === '8-10');
    if (highRange) {
      expect(highRange.winRate).toBe(100);
    }

    db.close();
  });
});
