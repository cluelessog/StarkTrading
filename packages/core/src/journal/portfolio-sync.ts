import type { DataProvider, BrokerPosition } from '../api/data-provider.js';
import { TradeManager } from './trade-manager.js';
import { Queries } from '../db/queries.js';

export interface SyncResult {
  newEntries: Array<{ symbol: string; shares: number; entryPrice: number }>;
  autoExits: Array<{ symbol: string; exitPrice: number; pnl: number }>;
  warnings: string[];
  alreadySynced: number;
}

export class PortfolioSync {
  constructor(
    private tradeManager: TradeManager,
    private provider: DataProvider,
    private queries: Queries,
  ) {}

  async sync(): Promise<SyncResult> {
    const positions = await this.provider.fetchPositions();
    const openTrades = this.queries.getOpenTrades();
    const result: SyncResult = { newEntries: [], autoExits: [], warnings: [], alreadySynced: 0 };

    // New broker positions not in Stark
    for (const pos of positions) {
      const existingTrade = openTrades.find(t => t.symbol === pos.symbol);
      if (existingTrade) {
        // Check for partial quantity changes
        if (existingTrade.shares !== pos.quantity) {
          result.warnings.push(`${pos.symbol}: quantity mismatch (broker: ${pos.quantity}, stark: ${existingTrade.shares}), skipped`);
        } else {
          result.alreadySynced++;
        }
        continue;
      }
      // New position: auto-log entry with stopPrice: undefined (risk math skipped)
      try {
        this.tradeManager.entry({
          symbol: pos.symbol,
          entryPrice: pos.averagePrice,
          shares: pos.quantity,
          stopPrice: undefined,
          conviction: 'MEDIUM',
          tradeType: 'swing',
          force: true,
        });
        result.newEntries.push({ symbol: pos.symbol, shares: pos.quantity, entryPrice: pos.averagePrice });
        this.queries.insertAutomationLog('sync_entry', 'success', `Auto-logged ${pos.symbol}: ${pos.quantity} @ ${pos.averagePrice}`, 'sync');
      } catch (err) {
        const msg = (err as Error).message ?? '';
        if (msg.includes('Already have open trade')) {
          result.alreadySynced++;
        } else {
          result.warnings.push(`${pos.symbol}: unexpected error during sync — ${msg}`);
        }
      }
    }

    // Open trades in Stark but not in broker — leave OPEN with warning
    const brokerSymbols = new Set(positions.map(p => p.symbol));
    for (const trade of openTrades) {
      if (!brokerSymbols.has(trade.symbol)) {
        result.warnings.push(`${trade.symbol}: open in Stark but missing from broker — leaving OPEN (verify manually)`);
        this.queries.insertAutomationLog('sync_unresolved', 'skipped', `${trade.symbol}: missing from broker positions`, 'sync');
      }
    }

    return result;
  }
}
