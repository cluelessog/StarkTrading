import { Database } from 'bun:sqlite';
import { join } from 'path';
import { getStarkDir, loadConfig } from '@stark/core';
import { MIGRATIONS } from '@stark/core/src/db/schema.js';
import { TradeManager } from '@stark/core/src/journal/trade-manager.js';
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

export async function entryCommand(args: string[]): Promise<void> {
  if (args.length === 0 || args.includes('--help')) {
    console.log('Usage: stark entry <SYMBOL> --price <N> --shares <N> --stop <N> [--conviction HIGH|MEDIUM|LOW]');
    return;
  }

  const symbol = args[0].toUpperCase();

  const getArg = (flag: string): string | undefined => {
    const idx = args.indexOf(flag);
    return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined;
  };

  const priceStr = getArg('--price');
  const sharesStr = getArg('--shares');
  const stopStr = getArg('--stop');
  const conviction = (getArg('--conviction') ?? 'MEDIUM').toUpperCase() as 'HIGH' | 'MEDIUM' | 'LOW';

  if (!priceStr || !sharesStr || !stopStr) {
    console.error('Error: --price, --shares, and --stop are required');
    console.error('Example: stark entry RELIANCE --price 2850 --shares 100 --stop 2780');
    process.exit(1);
  }

  const entryPrice = parseFloat(priceStr);
  const shares = parseInt(sharesStr, 10);
  const stopPrice = parseFloat(stopStr);

  if (isNaN(entryPrice) || isNaN(shares) || isNaN(stopPrice)) {
    console.error('Error: price, shares, and stop must be valid numbers');
    process.exit(1);
  }

  if (stopPrice >= entryPrice) {
    console.error('Error: stop price must be below entry price');
    process.exit(1);
  }

  const config = loadConfig();
  const dbPath = join(getStarkDir(), 'stark.db');
  const db = createAdapter(dbPath);
  for (const m of MIGRATIONS) db.execMulti(m.sql);

  try {
    const manager = new TradeManager(db);
    const result = manager.entry({
      symbol,
      entryPrice,
      shares,
      stopPrice,
      conviction,
    });

    // Check heat
    const heat = calculatePortfolioHeat(db, config.risk.swing);

    console.log(`\nTrade entered: ${result.symbol}`);
    console.log(`  Entry: Rs ${result.entryPrice.toLocaleString('en-IN')}`);
    console.log(`  Shares: ${result.shares}`);
    console.log(`  Stop: Rs ${result.stopPrice.toLocaleString('en-IN')}`);
    console.log(`  Risk: Rs ${result.riskAmount.toLocaleString('en-IN')}`);
    console.log(`  Conviction: ${result.conviction}`);
    if (result.scoreAtEntry != null) {
      console.log(`  Score at entry: ${result.scoreAtEntry}`);
    }
    if (result.regime) {
      console.log(`  Market regime: ${result.regime}`);
    }
    console.log(`  Trade ID: ${result.tradeId}`);

    // Heat warning
    console.log(`\n  Portfolio heat: ${heat.heatPct}% (${heat.status})`);
    if (heat.status === 'WARNING') {
      console.log(`  ⚠ Heat above ${heat.warningLevel}% warning level`);
    } else if (heat.status === 'ALERT') {
      console.log(`  ⚠ Heat above ${heat.alertLevel}% alert level — consider reducing exposure`);
    }
  } catch (err) {
    console.error(`Error: ${(err as Error).message}`);
    process.exit(1);
  } finally {
    db.close();
  }
}
