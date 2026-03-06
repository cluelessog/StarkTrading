import { Database } from 'bun:sqlite';
import { join } from 'path';
import { getStarkDir } from '@stark/core';
import { MIGRATIONS } from '@stark/core/src/db/schema.js';
import { TradeManager } from '@stark/core/src/journal/trade-manager.js';

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

export async function exitCommand(args: string[]): Promise<void> {
  if (args.length === 0 || args.includes('--help')) {
    console.log('Usage: stark exit <SYMBOL> --price <N> --reason STOPPED|TARGET|DISCRETION|INVALIDATED');
    return;
  }

  const symbol = args[0].toUpperCase();

  const getArg = (flag: string): string | undefined => {
    const idx = args.indexOf(flag);
    return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined;
  };

  const priceStr = getArg('--price');
  const reasonStr = (getArg('--reason') ?? '').toUpperCase();

  if (!priceStr) {
    console.error('Error: --price is required');
    process.exit(1);
  }

  const validReasons = ['STOPPED', 'TARGET', 'DISCRETION', 'INVALIDATED'];
  if (!validReasons.includes(reasonStr)) {
    console.error(`Error: --reason must be one of: ${validReasons.join(', ')}`);
    process.exit(1);
  }

  const exitPrice = parseFloat(priceStr);
  if (isNaN(exitPrice)) {
    console.error('Error: price must be a valid number');
    process.exit(1);
  }

  const dbPath = join(getStarkDir(), 'stark.db');
  const db = createAdapter(dbPath);
  for (const m of MIGRATIONS) db.execMulti(m.sql);

  try {
    const manager = new TradeManager(db);
    const result = manager.exit({
      symbol,
      exitPrice,
      exitReason: reasonStr as 'STOPPED' | 'TARGET' | 'DISCRETION' | 'INVALIDATED',
    });

    const pnlSign = result.pnl >= 0 ? '+' : '';
    const rSign = result.rMultiple >= 0 ? '+' : '';

    console.log(`\nTrade closed: ${result.symbol}`);
    console.log(`  Entry: Rs ${result.entryPrice.toLocaleString('en-IN')}`);
    console.log(`  Exit:  Rs ${result.exitPrice.toLocaleString('en-IN')}`);
    console.log(`  P&L:   ${pnlSign}Rs ${result.pnl.toLocaleString('en-IN')}`);
    console.log(`  R:     ${rSign}${result.rMultiple}R`);
    console.log(`  Hold:  ${result.holdDays} days`);
    console.log(`  Reason: ${result.exitReason}`);
  } catch (err) {
    console.error(`Error: ${(err as Error).message}`);
    process.exit(1);
  } finally {
    db.close();
  }
}
