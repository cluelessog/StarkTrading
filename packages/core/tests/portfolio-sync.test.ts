import { describe, it, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { MIGRATIONS } from '../src/db/schema.js';
import { Queries } from '../src/db/queries.js';
import { TradeManager } from '../src/journal/trade-manager.js';
import { PortfolioSync } from '../src/journal/portfolio-sync.js';
import type { DataProvider, BrokerPosition, Quote, SymbolSearchResult, InstrumentMaster } from '../src/api/data-provider.js';
import type { OHLCVBar, OHLCVInterval } from '../src/models/intervals.js';

// ---------------------------------------------------------------------------
// Test DB helper (matches trade-manager.test.ts pattern)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Mock DataProvider
// ---------------------------------------------------------------------------

function makeMockProvider(positions: BrokerPosition[]): DataProvider {
  return {
    name: 'mock_test',
    async authenticate(_creds: Record<string, string>): Promise<void> {},
    isAuthenticated(): boolean { return true; },
    async dispose(): Promise<void> {},
    async fetchOHLCV(_symbol: string, _token: string, _interval: OHLCVInterval, _from: string, _to: string): Promise<OHLCVBar[]> { return []; },
    async fetchQuote(symbol: string, token: string): Promise<Quote> {
      return { symbol, token, ltp: 100, open: 100, high: 100, low: 100, close: 100, volume: 0, timestamp: '' };
    },
    async fetchQuotes(symbols: Array<{ symbol: string; token: string }>): Promise<Quote[]> {
      return symbols.map(s => ({ symbol: s.symbol, token: s.token, ltp: 100, open: 100, high: 100, low: 100, close: 100, volume: 0, timestamp: '' }));
    },
    async searchSymbol(_query: string): Promise<SymbolSearchResult[]> { return []; },
    async getInstrumentMaster(_exchange?: string): Promise<InstrumentMaster[]> { return []; },
    async fetchPositions(): Promise<BrokerPosition[]> { return positions; },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PortfolioSync', () => {
  it('syncs new broker positions as trade entries', async () => {
    const db = createTestDb();
    const queries = new Queries(db);
    const tradeManager = new TradeManager(db);
    const positions: BrokerPosition[] = [
      { symbol: 'RELIANCE', token: '2885', exchange: 'NSE', quantity: 100, averagePrice: 2450, lastPrice: 2500, pnl: 5000, productType: 'CNC' },
    ];
    const sync = new PortfolioSync(tradeManager, makeMockProvider(positions), queries);

    const result = await sync.sync();

    expect(result.newEntries).toHaveLength(1);
    expect(result.newEntries[0].symbol).toBe('RELIANCE');
    expect(result.newEntries[0].shares).toBe(100);
    expect(result.newEntries[0].entryPrice).toBe(2450);
    expect(result.alreadySynced).toBe(0);
    expect(result.autoExits).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);

    // Verify trade was actually inserted with stopPrice=null (risk math skipped)
    const openTrades = tradeManager.getOpenTrades();
    expect(openTrades).toHaveLength(1);
    expect(openTrades[0].symbol).toBe('RELIANCE');
    expect(openTrades[0].stopPrice).toBeNull();
    expect(openTrades[0].riskAmount).toBeNull();

    db.close();
  });

  it('detects exited positions and auto-closes trades', async () => {
    const db = createTestDb();
    const queries = new Queries(db);
    const tradeManager = new TradeManager(db);

    // Pre-seed an open trade
    tradeManager.entry({ symbol: 'TCS', entryPrice: 3800, shares: 50, conviction: 'MEDIUM' });

    // Broker shows no positions (trade was exited externally)
    const sync = new PortfolioSync(tradeManager, makeMockProvider([]), queries);
    const result = await sync.sync();

    expect(result.autoExits).toHaveLength(1);
    expect(result.autoExits[0].symbol).toBe('TCS');
    expect(result.autoExits[0].exitPrice).toBe(3800); // falls back to entryPrice
    expect(result.newEntries).toHaveLength(0);

    // Verify trade is now closed
    expect(tradeManager.getOpenTrades()).toHaveLength(0);
    expect(tradeManager.getClosedTrades()).toHaveLength(1);

    db.close();
  });

  it('skips already-synced positions (idempotent)', async () => {
    const db = createTestDb();
    const queries = new Queries(db);
    const tradeManager = new TradeManager(db);

    // Pre-seed matching open trade
    tradeManager.entry({ symbol: 'INFY', entryPrice: 1650, shares: 200, conviction: 'HIGH' });

    const positions: BrokerPosition[] = [
      { symbol: 'INFY', token: '1594', exchange: 'NSE', quantity: 200, averagePrice: 1650, lastPrice: 1700, pnl: 10000, productType: 'CNC' },
    ];
    const sync = new PortfolioSync(tradeManager, makeMockProvider(positions), queries);
    const result = await sync.sync();

    expect(result.alreadySynced).toBe(1);
    expect(result.newEntries).toHaveLength(0);
    expect(result.autoExits).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);

    // Still only one open trade
    expect(tradeManager.getOpenTrades()).toHaveLength(1);

    db.close();
  });

  it('warns on partial quantity changes', async () => {
    const db = createTestDb();
    const queries = new Queries(db);
    const tradeManager = new TradeManager(db);

    // Stark has 100 shares, broker has 75 (partial exit not tracked)
    tradeManager.entry({ symbol: 'SBIN', entryPrice: 780, shares: 100, conviction: 'LOW' });

    const positions: BrokerPosition[] = [
      { symbol: 'SBIN', token: '3045', exchange: 'NSE', quantity: 75, averagePrice: 780, lastPrice: 790, pnl: 750, productType: 'CNC' },
    ];
    const sync = new PortfolioSync(tradeManager, makeMockProvider(positions), queries);
    const result = await sync.sync();

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('SBIN');
    expect(result.warnings[0]).toContain('quantity mismatch');
    expect(result.newEntries).toHaveLength(0);
    expect(result.alreadySynced).toBe(0);

    db.close();
  });

  it('logs all actions to automation_log', async () => {
    const db = createTestDb();
    const queries = new Queries(db);
    const tradeManager = new TradeManager(db);

    const positions: BrokerPosition[] = [
      { symbol: 'BHARTIARTL', token: '10604', exchange: 'NSE', quantity: 50, averagePrice: 1550, lastPrice: 1600, pnl: 2500, productType: 'CNC' },
    ];
    const sync = new PortfolioSync(tradeManager, makeMockProvider(positions), queries);
    await sync.sync();

    const logs = queries.getAutomationLogs(10);
    expect(logs.length).toBeGreaterThanOrEqual(1);
    expect(logs.some(l => l.action === 'sync_entry' && l.details?.includes('BHARTIARTL'))).toBe(true);

    db.close();
  });

  it('does not create duplicate entries on repeated sync', async () => {
    const db = createTestDb();
    const queries = new Queries(db);
    const tradeManager = new TradeManager(db);

    const positions: BrokerPosition[] = [
      { symbol: 'ITC', token: '1660', exchange: 'NSE', quantity: 300, averagePrice: 450, lastPrice: 455, pnl: 1500, productType: 'CNC' },
    ];
    const provider = makeMockProvider(positions);
    const sync = new PortfolioSync(tradeManager, provider, queries);

    // First sync — creates entry
    const result1 = await sync.sync();
    expect(result1.newEntries).toHaveLength(1);

    // Second sync — should skip (already synced)
    const result2 = await sync.sync();
    expect(result2.newEntries).toHaveLength(0);
    expect(result2.alreadySynced).toBe(1);

    // Only one open trade total
    expect(tradeManager.getOpenTrades()).toHaveLength(1);

    db.close();
  });
});
