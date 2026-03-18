import { Database } from 'bun:sqlite';
import { join } from 'path';
import { getStarkDir } from '@stark/core';
import { MIGRATIONS } from '@stark/core/db/schema.js';
import { TradeManager } from '@stark/core/journal/trade-manager.js';
import type { TradeJournalEntry } from '@stark/core/db/queries.js';

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

function formatTrade(t: TradeJournalEntry): string {
  const lines: string[] = [];
  const status = t.status === 'OPEN' ? 'OPEN' : 'CLOSED';

  lines.push(`  [${t.id}] ${t.symbol} (${status})`);
  lines.push(`    Entry: Rs ${t.entryPrice.toLocaleString('en-IN')} x ${t.shares} on ${t.entryDate}`);

  if (t.stopPrice != null) {
    lines.push(`    Stop:  Rs ${t.stopPrice.toLocaleString('en-IN')}  Risk: Rs ${(t.riskAmount ?? 0).toLocaleString('en-IN')}`);
  }

  if (t.status === 'CLOSED' && t.exitPrice != null) {
    const pnlSign = (t.pnl ?? 0) >= 0 ? '+' : '';
    const rSign = (t.rMultiple ?? 0) >= 0 ? '+' : '';
    lines.push(`    Exit:  Rs ${t.exitPrice.toLocaleString('en-IN')} on ${t.exitDate} (${t.exitReason})`);
    lines.push(`    P&L:   ${pnlSign}Rs ${(t.pnl ?? 0).toLocaleString('en-IN')}  R: ${rSign}${t.rMultiple ?? 0}R  Hold: ${t.holdDays ?? 0}d`);
  }

  if (t.scoreAtEntry != null) {
    lines.push(`    Score: ${t.scoreAtEntry}  Conviction: ${t.conviction ?? '-'}  Regime: ${t.marketRegimeAtEntry ?? '-'}`);
  }

  return lines.join('\n');
}

export async function tradesCommand(args: string[]): Promise<void> {
  if (args.includes('--help')) {
    console.log('Usage: stark trades [--open | --closed | --all]');
    return;
  }

  const filter = args.includes('--closed') ? 'closed'
    : args.includes('--all') ? 'all'
    : 'open';

  const dbPath = join(getStarkDir(), 'stark.db');
  const db = createAdapter(dbPath);
  for (const m of MIGRATIONS) db.execMulti(m.sql);

  try {
    const manager = new TradeManager(db);

    let trades: TradeJournalEntry[];
    let label: string;
    switch (filter) {
      case 'open':
        trades = manager.getOpenTrades();
        label = 'Open Trades';
        break;
      case 'closed':
        trades = manager.getClosedTrades();
        label = 'Closed Trades';
        break;
      default:
        trades = manager.getAllTrades();
        label = 'All Trades';
        break;
    }

    console.log(`\n${label} (${trades.length}):\n`);

    if (trades.length === 0) {
      console.log('  No trades found.');
      return;
    }

    for (const t of trades) {
      console.log(formatTrade(t));
      console.log('');
    }
  } finally {
    db.close();
  }
}
