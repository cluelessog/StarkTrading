import { Database } from 'bun:sqlite';
import { join } from 'path';
import { getStarkDir, loadConfig } from '@stark/core';
import { MIGRATIONS } from '@stark/core/src/db/schema.js';
import { calculatePortfolioHeat } from '@stark/core/src/journal/portfolio-heat.js';

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

export async function heatCommand(args: string[]): Promise<void> {
  if (args.includes('--help')) {
    console.log('Usage: stark heat');
    console.log('Shows portfolio heat (total risk / capital) with per-position breakdown.');
    return;
  }

  const config = loadConfig();
  const dbPath = join(getStarkDir(), 'stark.db');
  const db = createAdapter(dbPath);
  for (const m of MIGRATIONS) db.execMulti(m.sql);

  try {
    const heat = calculatePortfolioHeat(db, config.risk.swing);

    const statusIcon = heat.status === 'OK' ? 'OK'
      : heat.status === 'WARNING' ? 'WARNING'
      : 'ALERT';

    console.log(`\nPortfolio Heat: ${heat.heatPct}% [${statusIcon}]`);
    console.log(`  Total risk: Rs ${heat.totalRisk.toLocaleString('en-IN')}`);
    console.log(`  Capital:    Rs ${heat.totalCapital.toLocaleString('en-IN')}`);
    console.log(`  Warning:    ${heat.warningLevel}%`);
    console.log(`  Alert:      ${heat.alertLevel}%`);

    if (heat.positions.length === 0) {
      console.log('\n  No open positions.');
      return;
    }

    console.log(`\nPositions (${heat.positions.length}):\n`);
    console.log('  Symbol          Risk (Rs)     % Capital');
    console.log('  ' + '-'.repeat(45));

    for (const p of heat.positions) {
      const sym = p.symbol.padEnd(16);
      const risk = `Rs ${p.riskAmount.toLocaleString('en-IN')}`.padEnd(14);
      console.log(`  ${sym}${risk}${p.pctOfCapital.toFixed(1)}%`);
    }
  } finally {
    db.close();
  }
}
