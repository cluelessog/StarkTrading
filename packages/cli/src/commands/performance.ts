import { Database } from 'bun:sqlite';
import { join } from 'path';
import { getStarkDir } from '@stark/core';
import { MIGRATIONS } from '@stark/core/src/db/schema.js';
import { generatePerformanceReport, type BreakdownEntry } from '@stark/core/src/journal/performance.js';

function createAdapter(dbPath: string) {
  const db = new Database(dbPath);
  return {
    execute(sql: string, params: unknown[] = []) { db.prepare(sql).run(...(params as [string])); },
    execMulti(sql: string) { db.exec(sql); },
    query<T>(sql: string, params: unknown[] = []): T[] { return db.prepare(sql).all(...(params as [string])) as T[]; },
    queryOne<T>(sql: string, params: unknown[] = []): T | null { return (db.prepare(sql).get(...(params as [string])) as T | undefined) ?? null; },
    transaction<T>(fn: () => T): T { return db.transaction(fn)() as T; },
    close() { db.close(); },
  };
}

function printBreakdown(title: string, entries: BreakdownEntry[]): void {
  if (entries.length === 0) return;
  console.log(`\n${title}:`);
  console.log('  Label              Trades  Win%   Avg R   Total P&L');
  console.log('  ' + '-'.repeat(55));
  for (const e of entries) {
    const label = e.label.padEnd(18);
    const trades = String(e.trades).padEnd(8);
    const winRate = `${e.winRate}%`.padEnd(7);
    const avgR = (e.avgR >= 0 ? '+' : '') + `${e.avgR}R`.padEnd(8);
    const pnl = (e.totalPnl >= 0 ? '+' : '') + `Rs ${e.totalPnl.toLocaleString('en-IN')}`;
    console.log(`  ${label}${trades}${winRate}${avgR}${pnl}`);
  }
}

export async function performanceCommand(args: string[]): Promise<void> {
  if (args.includes('--help')) {
    console.log('Usage: stark performance');
    console.log('Shows win rate by score range, factor, regime, sector.');
    return;
  }

  const dbPath = join(getStarkDir(), 'stark.db');
  const db = createAdapter(dbPath);
  for (const m of MIGRATIONS) db.execMulti(m.sql);

  try {
    const report = generatePerformanceReport(db);
    const s = report.overall;

    console.log('\nPerformance Summary');
    console.log('='.repeat(40));

    if (!s.sufficientData) {
      console.log(`\n  Need ${s.minTradesNeeded} more closed trades for full analysis.`);
      console.log('  Showing basic stats:\n');
    }

    console.log(`  Total trades:  ${s.totalTrades} (${s.openTrades} open, ${s.closedTrades} closed)`);
    console.log(`  Win rate:      ${s.winRate}% (${s.wins}W / ${s.losses}L)`);
    console.log(`  Avg win:       +Rs ${s.avgWin.toLocaleString('en-IN')}`);
    console.log(`  Avg loss:      -Rs ${s.avgLoss.toLocaleString('en-IN')}`);
    console.log(`  Avg R:         ${s.avgRMultiple >= 0 ? '+' : ''}${s.avgRMultiple}R`);
    console.log(`  Expectancy:    ${s.expectancy >= 0 ? '+' : ''}Rs ${s.expectancy.toLocaleString('en-IN')} per trade`);
    console.log(`  Total P&L:     ${s.totalPnl >= 0 ? '+' : ''}Rs ${s.totalPnl.toLocaleString('en-IN')}`);
    console.log(`  Avg hold:      ${s.avgHoldDays} days`);

    if (s.sufficientData) {
      printBreakdown('By Score Range', report.byScoreRange);
      printBreakdown('By Market Regime', report.byRegime);
      printBreakdown('By Sector', report.bySector);
      printBreakdown('By Conviction', report.byConviction);

      if (report.overrideAccuracy) {
        const oa = report.overrideAccuracy;
        console.log('\nOverride Analysis:');
        console.log(`  With overrides:    ${oa.withOverrides} trades, ${oa.overrideWinRate}% win rate`);
        console.log(`  Without overrides: ${oa.withoutOverrides} trades, ${oa.noOverrideWinRate}% win rate`);
      }
    }
  } finally {
    db.close();
  }
}
