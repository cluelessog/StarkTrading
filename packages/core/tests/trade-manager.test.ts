import { describe, it, expect } from 'vitest';
import { Database } from 'bun:sqlite';
import { MIGRATIONS } from '../src/db/schema.js';
import { TradeManager } from '../src/journal/trade-manager.js';

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

describe('TradeManager', () => {
  it('enters a trade and returns result', () => {
    const db = createTestDb();
    const mgr = new TradeManager(db);

    const result = mgr.entry({
      symbol: 'RELIANCE',
      entryPrice: 2850,
      shares: 100,
      stopPrice: 2780,
      conviction: 'HIGH',
    });

    expect(result.tradeId).toBe(1);
    expect(result.symbol).toBe('RELIANCE');
    expect(result.riskAmount).toBe(7000); // (2850-2780)*100
    expect(result.conviction).toBe('HIGH');

    db.close();
  });

  it('prevents duplicate open trades for same symbol', () => {
    const db = createTestDb();
    const mgr = new TradeManager(db);

    mgr.entry({ symbol: 'TCS', entryPrice: 3500, shares: 50, stopPrice: 3400, conviction: 'MEDIUM' });

    expect(() =>
      mgr.entry({ symbol: 'TCS', entryPrice: 3600, shares: 50, stopPrice: 3500, conviction: 'LOW' })
    ).toThrow('Already have open trade');

    db.close();
  });

  it('exits a trade and calculates P&L', () => {
    const db = createTestDb();
    const mgr = new TradeManager(db);

    mgr.entry({ symbol: 'INFY', entryPrice: 1500, shares: 200, stopPrice: 1450, conviction: 'HIGH' });

    const result = mgr.exit({ symbol: 'INFY', exitPrice: 1600, exitReason: 'TARGET' });

    expect(result.pnl).toBe(20000); // (1600-1500)*200
    expect(result.rMultiple).toBe(2); // (1600-1500)/(1500-1450) = 100/50 = 2
    expect(result.exitReason).toBe('TARGET');
    expect(result.holdDays).toBeGreaterThanOrEqual(1);

    db.close();
  });

  it('throws when exiting non-existent trade', () => {
    const db = createTestDb();
    const mgr = new TradeManager(db);

    expect(() =>
      mgr.exit({ symbol: 'MISSING', exitPrice: 100, exitReason: 'STOPPED' })
    ).toThrow('No open trade found');

    db.close();
  });

  it('lists open and closed trades', () => {
    const db = createTestDb();
    const mgr = new TradeManager(db);

    mgr.entry({ symbol: 'SBIN', entryPrice: 600, shares: 500, stopPrice: 580, conviction: 'MEDIUM' });
    mgr.entry({ symbol: 'ITC', entryPrice: 450, shares: 300, stopPrice: 430, conviction: 'LOW' });
    mgr.exit({ symbol: 'ITC', exitPrice: 470, exitReason: 'DISCRETION' });

    expect(mgr.getOpenTrades()).toHaveLength(1);
    expect(mgr.getClosedTrades()).toHaveLength(1);
    expect(mgr.getAllTrades()).toHaveLength(2);
    expect(mgr.getOpenTrades()[0].symbol).toBe('SBIN');
    expect(mgr.getClosedTrades()[0].symbol).toBe('ITC');

    db.close();
  });

  it('calculates negative P&L on stopped trade', () => {
    const db = createTestDb();
    const mgr = new TradeManager(db);

    mgr.entry({ symbol: 'HDFCBANK', entryPrice: 1700, shares: 100, stopPrice: 1650, conviction: 'MEDIUM' });
    const result = mgr.exit({ symbol: 'HDFCBANK', exitPrice: 1650, exitReason: 'STOPPED' });

    expect(result.pnl).toBe(-5000); // (1650-1700)*100
    expect(result.rMultiple).toBe(-1); // -50/50
    db.close();
  });
});
