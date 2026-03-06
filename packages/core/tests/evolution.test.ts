import { describe, it, expect } from 'vitest';
import { Database } from 'bun:sqlite';
import { MIGRATIONS } from '../src/db/schema.js';
import { generateEvolutionReport } from '../src/journal/evolution.js';

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

function makeBreakdown(factors: { id: string; name: string; score: number }[]) {
  return JSON.stringify({
    factors: factors.map(f => ({
      factorId: f.id,
      factorName: f.name,
      score: f.score,
      maxScore: 1,
      dataSource: 'test',
      reasoning: 'test',
    })),
    algorithmicScore: factors.reduce((s, f) => s + f.score, 0),
    discretionaryScore: 0,
    totalScore: factors.reduce((s, f) => s + f.score, 0),
    maxPossibleScore: 12.5,
  });
}

describe('generateEvolutionReport', () => {
  it('returns insufficient data with < 30 trades', () => {
    const db = createTestDb();
    const report = generateEvolutionReport(db);

    expect(report.sufficientData).toBe(false);
    expect(report.minTradesNeeded).toBe(30);

    db.close();
  });

  it('analyzes factor edges with sufficient trades', () => {
    const db = createTestDb();

    const factors = [
      { id: 'high_rs', name: 'High RS', score: 1 },
      { id: 'ep_catalyst', name: 'EP Catalyst', score: 0 },
    ];

    // Insert 35 closed trades — wins have high_rs=1, losses have high_rs=0
    for (let i = 0; i < 20; i++) {
      const winFactors = [
        { id: 'high_rs', name: 'High RS', score: 1 },
        { id: 'ep_catalyst', name: 'EP Catalyst', score: i % 2 === 0 ? 1 : 0 },
      ];
      db.execute(
        `INSERT INTO trade_journal (symbol, trade_type, entry_date, entry_price, shares, stop_price,
           exit_date, exit_price, exit_reason, pnl, r_multiple, hold_days,
           score_at_entry, score_breakdown_json, conviction, status)
         VALUES (?, 'swing', '2026-01-01', 100, 100, 90,
           '2026-01-10', 120, 'TARGET', 2000, 2, 9, 9, ?, 'HIGH', 'CLOSED')`,
        [`WIN_${i}`, makeBreakdown(winFactors)]
      );
    }

    for (let i = 0; i < 15; i++) {
      const loseFactors = [
        { id: 'high_rs', name: 'High RS', score: i < 5 ? 1 : 0 },
        { id: 'ep_catalyst', name: 'EP Catalyst', score: i % 3 === 0 ? 1 : 0 },
      ];
      db.execute(
        `INSERT INTO trade_journal (symbol, trade_type, entry_date, entry_price, shares, stop_price,
           exit_date, exit_price, exit_reason, pnl, r_multiple, hold_days,
           score_at_entry, score_breakdown_json, conviction, status)
         VALUES (?, 'swing', '2026-01-01', 100, 100, 90,
           '2026-01-10', 80, 'STOPPED', -2000, -2, 9, 6, ?, 'LOW', 'CLOSED')`,
        [`LOSS_${i}`, makeBreakdown(loseFactors)]
      );
    }

    const report = generateEvolutionReport(db);

    expect(report.sufficientData).toBe(true);
    expect(report.closedTrades).toBe(35);
    expect(report.factorEdges.length).toBeGreaterThan(0);
    expect(report.recommendations.length).toBeGreaterThan(0);

    // high_rs should show positive edge (present in most wins)
    const highRsEdge = report.factorEdges.find(f => f.factorId === 'high_rs');
    if (highRsEdge) {
      expect(highRsEdge.presentWinRate).toBeGreaterThan(highRsEdge.absentWinRate);
      expect(highRsEdge.edge).toBeGreaterThan(0);
    }

    db.close();
  });

  it('handles trades without breakdown JSON', () => {
    const db = createTestDb();

    // Insert 35 trades without breakdown
    for (let i = 0; i < 35; i++) {
      db.execute(
        `INSERT INTO trade_journal (symbol, trade_type, entry_date, entry_price, shares, stop_price,
           exit_date, exit_price, exit_reason, pnl, r_multiple, hold_days,
           score_at_entry, conviction, status)
         VALUES (?, 'swing', '2026-01-01', 100, 100, 90,
           '2026-01-10', 110, 'TARGET', 1000, 1, 9, 8, 'HIGH', 'CLOSED')`,
        [`T_${i}`]
      );
    }

    const report = generateEvolutionReport(db);

    // Not sufficient because no breakdowns
    expect(report.sufficientData).toBe(false);
    expect(report.recommendations).toContain('Not enough trades with score breakdown data for factor analysis.');

    db.close();
  });
});
