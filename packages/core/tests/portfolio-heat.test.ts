import { describe, it, expect } from 'vitest';
import { Database } from 'bun:sqlite';
import { MIGRATIONS } from '../src/db/schema.js';
import { TradeManager } from '../src/journal/trade-manager.js';
import { calculatePortfolioHeat } from '../src/journal/portfolio-heat.js';
import type { RiskProfile } from '../src/config/index.js';

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

const RISK_PROFILE: RiskProfile = {
  riskPerTrade: 10000,
  totalCapital: 500000,
  heatWarning: 0.06,
  heatAlert: 0.08,
};

describe('calculatePortfolioHeat', () => {
  it('returns zero heat with no positions', () => {
    const db = createTestDb();
    const heat = calculatePortfolioHeat(db, RISK_PROFILE);

    expect(heat.totalRisk).toBe(0);
    expect(heat.heatPct).toBe(0);
    expect(heat.status).toBe('OK');
    expect(heat.positions).toHaveLength(0);

    db.close();
  });

  it('calculates heat from open trades', () => {
    const db = createTestDb();
    const mgr = new TradeManager(db);

    mgr.entry({ symbol: 'RELIANCE', entryPrice: 2850, shares: 100, stopPrice: 2780, conviction: 'HIGH' });
    mgr.entry({ symbol: 'TCS', entryPrice: 3500, shares: 50, stopPrice: 3400, conviction: 'MEDIUM' });

    const heat = calculatePortfolioHeat(db, RISK_PROFILE);

    // RELIANCE risk = (2850-2780)*100 = 7000
    // TCS risk = (3500-3400)*50 = 5000
    // Total = 12000, heat = 12000/500000 = 2.4%
    expect(heat.totalRisk).toBe(12000);
    expect(heat.heatPct).toBe(2.4);
    expect(heat.status).toBe('OK');
    expect(heat.positions).toHaveLength(2);

    db.close();
  });

  it('shows WARNING status at 6%', () => {
    const db = createTestDb();
    const mgr = new TradeManager(db);

    // Create enough positions to hit 6%+ (30000/500000 = 6%)
    mgr.entry({ symbol: 'A', entryPrice: 1000, shares: 100, stopPrice: 900, conviction: 'HIGH' }); // 10000
    mgr.entry({ symbol: 'B', entryPrice: 1000, shares: 100, stopPrice: 900, conviction: 'HIGH' }); // 10000
    mgr.entry({ symbol: 'C', entryPrice: 1000, shares: 100, stopPrice: 900, conviction: 'HIGH' }); // 10000

    const heat = calculatePortfolioHeat(db, RISK_PROFILE);
    expect(heat.totalRisk).toBe(30000);
    expect(heat.heatPct).toBe(6);
    expect(heat.status).toBe('WARNING');

    db.close();
  });

  it('shows ALERT status at 8%', () => {
    const db = createTestDb();
    const mgr = new TradeManager(db);

    // 40000/500000 = 8%
    mgr.entry({ symbol: 'A', entryPrice: 1000, shares: 100, stopPrice: 900, conviction: 'HIGH' });
    mgr.entry({ symbol: 'B', entryPrice: 1000, shares: 100, stopPrice: 900, conviction: 'HIGH' });
    mgr.entry({ symbol: 'C', entryPrice: 1000, shares: 100, stopPrice: 900, conviction: 'HIGH' });
    mgr.entry({ symbol: 'D', entryPrice: 1000, shares: 100, stopPrice: 900, conviction: 'HIGH' });

    const heat = calculatePortfolioHeat(db, RISK_PROFILE);
    expect(heat.totalRisk).toBe(40000);
    expect(heat.heatPct).toBe(8);
    expect(heat.status).toBe('ALERT');

    db.close();
  });

  it('excludes closed trades from heat', () => {
    const db = createTestDb();
    const mgr = new TradeManager(db);

    mgr.entry({ symbol: 'OPEN1', entryPrice: 1000, shares: 100, stopPrice: 900, conviction: 'HIGH' });
    mgr.entry({ symbol: 'CLOSED1', entryPrice: 1000, shares: 100, stopPrice: 900, conviction: 'HIGH' });
    mgr.exit({ symbol: 'CLOSED1', exitPrice: 1100, exitReason: 'TARGET' });

    const heat = calculatePortfolioHeat(db, RISK_PROFILE);
    expect(heat.positions).toHaveLength(1);
    expect(heat.totalRisk).toBe(10000);

    db.close();
  });
});
