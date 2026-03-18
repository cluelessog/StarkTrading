import { Database } from 'bun:sqlite';
import { join } from 'path';
import { getStarkDir } from '@stark/core';
import { MIGRATIONS } from '@stark/core/src/db/schema.js';
import { generateEvolutionReport } from '@stark/core/src/journal/evolution.js';

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

export async function evolveCommand(args: string[]): Promise<void> {
  if (args.includes('--help')) {
    console.log('Usage: stark evolve');
    console.log('Shows factor correlation, edge calculation, and recommendations (requires 30+ closed trades).');
    return;
  }

  const dbPath = join(getStarkDir(), 'stark.db');
  const db = createAdapter(dbPath);
  for (const m of MIGRATIONS) db.execMulti(m.sql);

  try {
    const report = generateEvolutionReport(db);

    console.log('\nScoring Evolution');
    console.log('='.repeat(40));
    console.log(`  Closed trades: ${report.closedTrades}`);

    if (!report.sufficientData) {
      console.log(`\n  Need ${report.minTradesNeeded} more closed trades for evolution analysis.`);
      return;
    }

    if (report.factorEdges.length > 0) {
      console.log('\nFactor Edge Analysis:');
      console.log('  Factor               Present  Absent   Edge    Sample');
      console.log('  ' + '-'.repeat(58));

      for (const f of report.factorEdges) {
        const name = f.factorName.padEnd(21);
        const present = `${f.presentWinRate}%`.padEnd(9);
        const absent = `${f.absentWinRate}%`.padEnd(9);
        const edge = (f.edge >= 0 ? '+' : '') + `${f.edge}%`.padEnd(8);
        const sample = `${f.tradesWith}/${f.tradesWithout}`;
        console.log(`  ${name}${present}${absent}${edge}${sample}`);
      }
    }

    if (report.discretionaryAccuracy.length > 0) {
      console.log('\nDiscretionary Factor Accuracy:');
      console.log('  Factor               Win%   Trades');
      console.log('  ' + '-'.repeat(40));

      for (const d of report.discretionaryAccuracy) {
        const name = d.factorName.padEnd(21);
        console.log(`  ${name}${d.winRate}%    ${d.trades}`);
      }
    }

    if (report.recommendations.length > 0) {
      console.log('\nRecommendations:');
      for (const r of report.recommendations) {
        console.log(`  - ${r}`);
      }
    }
  } finally {
    db.close();
  }
}
