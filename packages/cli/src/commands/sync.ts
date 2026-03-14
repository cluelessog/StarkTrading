import { createCommandContext } from '../utils/command-context.js';
import { TradeManager } from '@stark/core/journal/trade-manager.js';
import { PortfolioSync } from '@stark/core/journal/portfolio-sync.js';

export async function syncCommand(_args: string[]): Promise<void> {
  const { db, queries, provider } = await createCommandContext();
  const tradeManager = new TradeManager(db);
  const portfolioSync = new PortfolioSync(tradeManager, provider, queries);

  console.log('=== Portfolio Sync ===\n');
  const result = await portfolioSync.sync();

  if (result.newEntries.length > 0) {
    console.log(`New entries: ${result.newEntries.length}`);
    for (const e of result.newEntries) {
      console.log(`  ${e.symbol}: ${e.shares} shares @ ${e.entryPrice}`);
    }
    console.log('  -> Set stop prices with `stark exit --override`\n');
  }
  if (result.autoExits.length > 0) {
    console.log(`Auto exits: ${result.autoExits.length}`);
    for (const e of result.autoExits) {
      console.log(`  ${e.symbol}: exited @ ${e.exitPrice}, P&L: ${e.pnl}`);
    }
    console.log('');
  }
  if (result.warnings.length > 0) {
    console.log(`Warnings: ${result.warnings.length}`);
    for (const w of result.warnings) console.log(`  ${w}`);
    console.log('');
  }
  console.log(`Already synced: ${result.alreadySynced}`);
  console.log('Done.');
}
