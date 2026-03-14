import { describe, it, expect } from 'bun:test';
import { createToolRegistry } from '../src/executor.js';
import type { PersistentCommandContext } from '@stark/cli/utils/command-context.js';

/** Build a minimal mock PersistentCommandContext for executor tests. */
function makeMockCtx(): PersistentCommandContext {
  const mockQueries = {
    getOpenTrades: () => [
      { id: 1, symbol: 'RELIANCE', entryPrice: 2500, shares: 100, stopPrice: 2450, status: 'open', rMultiple: null },
    ],
    getClosedTrades: () => [
      { id: 2, symbol: 'INFY', entryPrice: 1500, shares: 50, stopPrice: 1450, status: 'closed', rMultiple: 1.5 },
      { id: 3, symbol: 'TCS', entryPrice: 3500, shares: 20, stopPrice: 3400, status: 'closed', rMultiple: -0.5 },
    ],
    getAllTrades: () => [
      { id: 1, symbol: 'RELIANCE', status: 'open' },
      { id: 2, symbol: 'INFY', status: 'closed' },
      { id: 3, symbol: 'TCS', status: 'closed' },
    ],
    getLatestMBI: () => ({ em: 18.5, source: 'breadth' }),
    getLatestMarketContext: () => ({ mbiRegime: 'bull' }),
    getWatchlistStocks: () => [],
    getDailyAverageScores: () => [
      { date: '2026-03-10', avgScore: 8.2, count: 5 },
      { date: '2026-03-11', avgScore: 8.5, count: 5 },
    ],
    getMBIHistory: () => [
      { em: 17.0, source: 'sheet' },
      { em: 18.5, source: 'breadth' },
    ],
    getAutomationLogs: () => [
      { action: 'evening_scoring', status: 'success', details: null, triggeredBy: 'cron', createdAt: '2026-03-11T16:30:00' },
    ],
  };

  const mockDb = {
    query: <T>(_sql: string) => [] as T[],
    queryOne: <T>(_sql: string) => null as T | null,
  };

  return {
    config: {
      risk: {
        swing: { riskPerTrade: 10000, totalCapital: 500000, heatWarning: 0.06, heatAlert: 0.08 },
        intraday: { riskPerTrade: 10000, totalCapital: 500000, heatWarning: 0.06, heatAlert: 0.08 },
      },
    },
    db: mockDb,
    queries: mockQueries,
    provider: {},
    llmService: null,
    engine: {
      scoreSymbol: async (symbol: string) => ({
        symbol,
        totalScore: 9.5,
        maxPossibleScore: 13,
        status: 'COMPLETE',
        factors: [],
      }),
      scoreBatch: async () => ({ results: [] }),
    },
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    mbiManager: {},
    dispose: () => {},
    refreshAuth: async () => {},
    isHealthy: () => true,
  } as unknown as PersistentCommandContext;
}

describe('Executor (createToolRegistry)', () => {
  it('registers 18 tools', () => {
    const ctx = makeMockCtx();
    const registry = createToolRegistry(ctx);
    expect(registry.getAll().length).toBe(18);
  });

  it('help tool returns all tool names', async () => {
    const ctx = makeMockCtx();
    const registry = createToolRegistry(ctx);
    const help = registry.get('help')!;
    const result = await help.execute({});
    expect(result.data).toBeArray();
    expect((result.data as string[]).length).toBe(18);
    expect(result.summary).toContain('score');
    expect(result.summary).toContain('help');
  });

  it('trades tool returns open trades by default', async () => {
    const ctx = makeMockCtx();
    const registry = createToolRegistry(ctx);
    const trades = registry.get('trades')!;
    const result = await trades.execute({});
    expect(result.summary).toContain('open');
    expect(result.summary).toContain('1');
  });

  it('trades tool returns closed trades when filter=closed', async () => {
    const ctx = makeMockCtx();
    const registry = createToolRegistry(ctx);
    const trades = registry.get('trades')!;
    const result = await trades.execute({ filter: 'closed' });
    expect(result.summary).toContain('closed');
    expect(result.summary).toContain('2');
  });

  it('status tool shows open trade count and regime', async () => {
    const ctx = makeMockCtx();
    const registry = createToolRegistry(ctx);
    const status = registry.get('status')!;
    const result = await status.execute({});
    expect(result.summary).toContain('1 open trades');
    expect(result.summary).toContain('bull');
  });

  it('market tool shows regime and EM', async () => {
    const ctx = makeMockCtx();
    const registry = createToolRegistry(ctx);
    const market = registry.get('market')!;
    const result = await market.execute({});
    expect(result.summary).toContain('bull');
    expect(result.summary).toContain('18.5');
  });

  it('score tool requires a symbol', async () => {
    const ctx = makeMockCtx();
    const registry = createToolRegistry(ctx);
    const score = registry.get('score')!;
    const result = await score.execute({});
    expect(result.summary).toContain('No symbol');
  });

  it('score tool returns score for a valid symbol', async () => {
    const ctx = makeMockCtx();
    const registry = createToolRegistry(ctx);
    const score = registry.get('score')!;
    const result = await score.execute({ symbol: 'reliance' });
    expect(result.summary).toContain('RELIANCE');
    expect(result.summary).toContain('9.5');
    expect(result.summary).toContain('13');
  });

  it('logs tool returns automation logs', async () => {
    const ctx = makeMockCtx();
    const registry = createToolRegistry(ctx);
    const logs = registry.get('logs')!;
    const result = await logs.execute({});
    expect(result.summary).toContain('1');
    expect(result.data).toBeArray();
  });

  it('evolve tool shows daily average scores', async () => {
    const ctx = makeMockCtx();
    const registry = createToolRegistry(ctx);
    const evolve = registry.get('evolve')!;
    const result = await evolve.execute({});
    expect(result.summary).toContain('2 days');
    expect(result.summary).toContain('8.5');
  });

  it('mbi-analyze tool shows MBI history', async () => {
    const ctx = makeMockCtx();
    const registry = createToolRegistry(ctx);
    const mbi = registry.get('mbi-analyze')!;
    const result = await mbi.execute({});
    expect(result.summary).toContain('2 days');
    expect(result.summary).toContain('18.5');
    expect(result.summary).toContain('breadth');
  });

  it('performance tool calculates win rate and total R', async () => {
    const ctx = makeMockCtx();
    const registry = createToolRegistry(ctx);
    const perf = registry.get('performance')!;
    const result = await perf.execute({});
    expect(result.summary).toContain('2 trades');
    expect(result.summary).toContain('50.0%');
    expect(result.summary).toContain('1.00R');
  });

  it('entry tool requires symbol, price, and shares', async () => {
    const ctx = makeMockCtx();
    const registry = createToolRegistry(ctx);
    const entry = registry.get('entry')!;
    const result = await entry.execute({});
    expect(result.summary).toContain('Usage');
  });

  it('exit tool requires symbol and price', async () => {
    const ctx = makeMockCtx();
    const registry = createToolRegistry(ctx);
    const exit = registry.get('exit')!;
    const result = await exit.execute({});
    expect(result.summary).toContain('Usage');
  });

  it('unknown tool returns undefined from registry', () => {
    const ctx = makeMockCtx();
    const registry = createToolRegistry(ctx);
    expect(registry.get('nonexistent')).toBeUndefined();
  });
});
