import { describe, it, expect } from 'bun:test';
import { createToolRegistry } from '../src/executor.js';
import type { PersistentCommandContext } from '@stark/cli/utils/command-context.js';

function makeMockCtx(closedTrades: unknown[] = []): PersistentCommandContext {
  return {
    config: {
      risk: {
        swing: { riskPerTrade: 10000, totalCapital: 500000, heatWarning: 0.06, heatAlert: 0.08 },
        intraday: { riskPerTrade: 10000, totalCapital: 500000, heatWarning: 0.06, heatAlert: 0.08 },
      },
    },
    db: { query: () => [], queryOne: () => null },
    queries: {
      getOpenTrades: () => [],
      getClosedTrades: () => closedTrades,
      getAllTrades: () => closedTrades,
      getLatestMBI: () => null,
      getLatestMarketContext: () => null,
      getWatchlistStocks: () => [],
      getDailyAverageScores: () => [],
      getMBIHistory: () => [],
      getAutomationLogs: () => [],
    },
    provider: {},
    llmService: null,
    engine: { scoreSymbol: async () => ({}), scoreBatch: async () => ({ results: [] }) },
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    mbiManager: {},
    dispose: () => {},
    refreshAuth: async () => {},
    isHealthy: () => true,
  } as unknown as PersistentCommandContext;
}

describe('Performance tool (enhanced)', () => {
  it('returns "No closed trades" when empty', async () => {
    const ctx = makeMockCtx([]);
    const registry = createToolRegistry(ctx);
    const perf = registry.get('performance')!;
    const result = await perf.execute({});
    expect(result.summary).toContain('No closed trades');
    expect(result.data).toBeNull();
  });

  it('shows profit factor, drawdown, streak for closed trades', async () => {
    const trades = [
      { id: 1, symbol: 'INFY', status: 'CLOSED', pnl: 2500, rMultiple: 1.5, exitDate: '2026-01-15', holdDays: 10, entryPrice: 1500, shares: 50, exitPrice: 1550, exitReason: 'TARGET', entryDate: '2026-01-05', conviction: 'MEDIUM', stopPrice: 1450, riskAmount: 2500, scoreAtEntry: null, scoreBreakdownJson: null, marketRegimeAtEntry: null, sectorAtEntry: null, overrideCount: 0, createdAt: '2026-01-05', tradeType: 'swing' },
      { id: 2, symbol: 'TCS', status: 'CLOSED', pnl: -2000, rMultiple: -0.5, exitDate: '2026-01-20', holdDays: 5, entryPrice: 3500, shares: 20, exitPrice: 3400, exitReason: 'STOPPED', entryDate: '2026-01-15', conviction: 'MEDIUM', stopPrice: 3400, riskAmount: 2000, scoreAtEntry: null, scoreBreakdownJson: null, marketRegimeAtEntry: null, sectorAtEntry: null, overrideCount: 0, createdAt: '2026-01-15', tradeType: 'swing' },
    ];
    const ctx = makeMockCtx(trades);
    const registry = createToolRegistry(ctx);
    const perf = registry.get('performance')!;
    const result = await perf.execute({});
    expect(result.summary).toContain('2 closed trades');
    expect(result.summary).toContain('Win rate: 50.0%');
    expect(result.summary).toContain('Profit factor: 1.25');
    expect(result.summary).toContain('Max drawdown');
    expect(result.summary).toContain('Current streak: 1L');
    expect(result.summary).toContain('Kelly');
    expect(result.summary).toContain('Avg hold: 7.5 days');
  });

  it('shows "Perfect (no losses)" when all trades are wins', async () => {
    const trades = [
      { id: 1, symbol: 'A', status: 'CLOSED', pnl: 300, rMultiple: 1.5, exitDate: '2026-01-10', holdDays: 5, entryPrice: 100, shares: 10, exitPrice: 130, exitReason: 'TARGET', entryDate: '2026-01-05', conviction: 'HIGH', stopPrice: 80, riskAmount: 200, scoreAtEntry: null, scoreBreakdownJson: null, marketRegimeAtEntry: null, sectorAtEntry: null, overrideCount: 0, createdAt: '2026-01-05', tradeType: 'swing' },
      { id: 2, symbol: 'B', status: 'CLOSED', pnl: 200, rMultiple: 1.0, exitDate: '2026-01-15', holdDays: 5, entryPrice: 200, shares: 10, exitPrice: 220, exitReason: 'TARGET', entryDate: '2026-01-10', conviction: 'MEDIUM', stopPrice: 180, riskAmount: 200, scoreAtEntry: null, scoreBreakdownJson: null, marketRegimeAtEntry: null, sectorAtEntry: null, overrideCount: 0, createdAt: '2026-01-10', tradeType: 'swing' },
    ];
    const ctx = makeMockCtx(trades);
    const registry = createToolRegistry(ctx);
    const perf = registry.get('performance')!;
    const result = await perf.execute({});
    expect(result.summary).toContain('100.0%');
    expect(result.summary).toContain('Perfect (no losses)');
    expect(result.summary).toContain('2W');
    expect(result.summary).toContain('None'); // no drawdown
  });
});
