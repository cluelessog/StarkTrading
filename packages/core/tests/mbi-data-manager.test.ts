import { describe, it, expect, beforeEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { MBIDataManager } from '../src/mbi/data-manager.js';
import type { MBISheetConfig } from '../src/mbi/data-manager.js';
import { Queries } from '../src/db/queries.js';
import { MIGRATIONS } from '../src/db/schema.js';
import type { DatabaseAdapter } from '../src/db/adapter.js';
import type { BreadthCalculator, BreadthResult } from '../src/market/breadth-calculator.js';
import type { ChartinkClient } from '../src/api/chartink.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createInMemoryAdapter(): DatabaseAdapter {
  const db = new Database(':memory:');
  for (const migration of MIGRATIONS) {
    db.exec(migration.sql);
  }
  return {
    execute(sql: string, params: any[] = []) {
      db.prepare(sql).run(...params);
    },
    execMulti(sql: string) {
      db.exec(sql);
    },
    query<T>(sql: string, params: any[] = []): T[] {
      return db.prepare(sql).all(...params) as T[];
    },
    queryOne<T>(sql: string, params: any[] = []): T | null {
      return (db.prepare(sql).get(...params) as T | undefined) ?? null;
    },
    transaction<T>(fn: () => T): T {
      return db.transaction(fn)() as T;
    },
    close() {
      db.close();
    },
  };
}

const DUMMY_SHEET_CONFIG: MBISheetConfig = {
  sheetId: 'fake-sheet-id',
};

function createMockBreadthCalculator(opts: {
  warm: boolean;
  result?: BreadthResult;
}): BreadthCalculator {
  return {
    isWarm: () => opts.warm,
    calculateBreadth: async () => {
      if (!opts.result) throw new Error('No breadth result configured');
      return opts.result;
    },
    calculateSMA: () => null,
    is52WeekHigh: () => false,
    is52WeekLow: () => false,
  } as unknown as BreadthCalculator;
}

function createMockChartinkClient(shouldThrow = true): ChartinkClient {
  return {
    fetchBreadthData: async () => {
      if (shouldThrow) {
        throw new Error('Chartink scraper not yet implemented');
      }
      return {
        pct52WH: 15,
        pct52WL: 5,
        pctAbove20SMA: 60,
        pctAbove50SMA: 55,
        pctAbove200SMA: 65,
        ratio4_5: 2.5,
        fetchedAt: new Date().toISOString(),
      };
    },
  } as ChartinkClient;
}

const MOCK_BREADTH_RESULT: BreadthResult = {
  pct52WH: 22,
  pct52WL: 4,
  pctAbove20SMA: 65,
  pctAbove50SMA: 60,
  pctAbove200SMA: 62,
  pctBelow200SMA: 38,
  ratio4_5: 2.1,
  f10: 55,
  f20: 52,
  f50: 60,
  totalStocks: 50,
  successfulStocks: 48,
  failedStocks: ['FAIL1', 'FAIL2'],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MBIDataManager fallback chain', () => {
  let db: DatabaseAdapter;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    db = createInMemoryAdapter();
    originalFetch = globalThis.fetch;
  });

  it('uses stale_cache when sheet, chartink, and breadth_only all fail', async () => {
    // Seed a cached MBI entry
    const queries = new Queries(db);
    queries.upsertMBIDaily({
      date: '2026-03-10',
      capturedAt: 'eod',
      source: 'sheet',
      em: 18.3,
      pct52WH: 15,
      pct52WL: 3,
      ratio4_5: 2.5,
      dataFreshness: 'fresh',
    });

    // Sheet will fail (mock fetch)
    globalThis.fetch = (() =>
      Promise.reject(new Error('Network error'))) as unknown as typeof fetch;

    try {
      const manager = new MBIDataManager(
        db,
        DUMMY_SHEET_CONFIG,
        undefined, // no breadth calculator
        undefined, // no chartink
      );

      const result = await manager.getLatestRegime();
      expect(result.source).toBe('stale_cache');
      expect(result.mbi.dataFreshness).toBe('stale');
      expect(result.mbi.source).toBe('stale_cache');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('uses breadth_only when sheet and chartink fail but breadth calculator is warm', async () => {
    // Sheet will fail
    globalThis.fetch = (() =>
      Promise.reject(new Error('Network error'))) as unknown as typeof fetch;

    try {
      const breadthCalc = createMockBreadthCalculator({
        warm: true,
        result: MOCK_BREADTH_RESULT,
      });

      const manager = new MBIDataManager(
        db,
        DUMMY_SHEET_CONFIG,
        breadthCalc,
        createMockChartinkClient(true), // chartink stub throws
      );

      const result = await manager.getLatestRegime();
      expect(result.source).toBe('breadth_only');
      expect(result.mbi.em).toBeNull();
      expect(result.mbi.source).toBe('breadth_only');
      expect(result.mbi.dataFreshness).toBe('fresh');
      expect(result.mbi.pct52WH).toBe(22);
      expect(result.mbi.pctAbove200SMA).toBe(62);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('skips breadth_only when calculator is not warm and falls to stale_cache', async () => {
    // Seed stale cache
    const queries = new Queries(db);
    queries.upsertMBIDaily({
      date: '2026-03-08',
      capturedAt: 'eod',
      source: 'sheet',
      em: 12.5,
      pct52WH: 10,
      pct52WL: 8,
      ratio4_5: 1.5,
      dataFreshness: 'fresh',
    });

    // Sheet will fail
    globalThis.fetch = (() =>
      Promise.reject(new Error('Network error'))) as unknown as typeof fetch;

    try {
      const breadthCalc = createMockBreadthCalculator({ warm: false });

      const manager = new MBIDataManager(
        db,
        DUMMY_SHEET_CONFIG,
        breadthCalc,
        createMockChartinkClient(true),
      );

      const result = await manager.getLatestRegime();
      expect(result.source).toBe('stale_cache');
      expect(result.mbi.dataFreshness).toBe('stale');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('stores fetched MBI data in the database', async () => {
    // Sheet will fail, breadth_only will succeed
    globalThis.fetch = (() =>
      Promise.reject(new Error('Network error'))) as unknown as typeof fetch;

    try {
      const breadthCalc = createMockBreadthCalculator({
        warm: true,
        result: MOCK_BREADTH_RESULT,
      });

      const manager = new MBIDataManager(
        db,
        DUMMY_SHEET_CONFIG,
        breadthCalc,
      );

      await manager.getLatestRegime();

      const queries = new Queries(db);
      const stored = queries.getLatestMBI();
      expect(stored).not.toBeNull();
      expect(stored!.source).toBe('breadth_only');
      expect(stored!.pct52WH).toBe(22);
      expect(stored!.pctAbove200SMA).toBe(62);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('returns cached data when fresh cache exists for today', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const queries = new Queries(db);
    queries.upsertMBIDaily({
      date: today,
      capturedAt: 'eod',
      source: 'sheet',
      em: 20,
      pct52WH: 18,
      pct52WL: 2,
      ratio4_5: 3.0,
      dataFreshness: 'fresh',
    });

    // fetch should NOT be called (cache hit)
    let fetchCalled = false;
    globalThis.fetch = (() => {
      fetchCalled = true;
      return Promise.reject(new Error('Should not be called'));
    }) as unknown as typeof fetch;

    try {
      const manager = new MBIDataManager(db, DUMMY_SHEET_CONFIG);
      const result = await manager.getLatestRegime();
      expect(result.source).toBe('cached:sheet');
      expect(result.mbi.em).toBe(20);
      expect(fetchCalled).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('throws AggregateError when all fallbacks fail and no cache exists', async () => {
    globalThis.fetch = (() =>
      Promise.reject(new Error('Network error'))) as unknown as typeof fetch;

    try {
      const manager = new MBIDataManager(db, DUMMY_SHEET_CONFIG);
      await expect(manager.getLatestRegime()).rejects.toThrow(
        'All 4 fallback options failed',
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('refreshMBI forces fetch even when fresh cache exists', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const queries = new Queries(db);
    queries.upsertMBIDaily({
      date: today,
      capturedAt: 'eod',
      source: 'sheet',
      em: 20,
      pct52WH: 18,
      pct52WL: 2,
      ratio4_5: 3.0,
      dataFreshness: 'fresh',
    });

    // Sheet fails, breadth_only succeeds
    globalThis.fetch = (() =>
      Promise.reject(new Error('Network error'))) as unknown as typeof fetch;

    try {
      const breadthCalc = createMockBreadthCalculator({
        warm: true,
        result: MOCK_BREADTH_RESULT,
      });

      const manager = new MBIDataManager(db, DUMMY_SHEET_CONFIG, breadthCalc);
      const result = await manager.refreshMBI();
      // Should NOT return cached data -- should go through fallback chain
      expect(result.source).toBe('breadth_only');
      expect(result.mbi.source).toBe('breadth_only');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe('Queries - market context', () => {
  it('upsertMarketContext and getMarketContextForDate roundtrip', () => {
    const db = createInMemoryAdapter();
    const queries = new Queries(db);

    queries.upsertMarketContext({
      date: '2026-03-11',
      niftyClose: 22500,
      nifty50DMA: 22000,
      nifty200DMA: 21000,
      mbiRegime: 'BULL',
      mbiEm: 18.3,
      mbiSource: 'sheet',
      createdAt: new Date().toISOString(),
    });

    const ctx = queries.getMarketContextForDate('2026-03-11');
    expect(ctx).not.toBeNull();
    expect(ctx!.date).toBe('2026-03-11');
    expect(ctx!.mbiRegime).toBe('BULL');
    expect(ctx!.mbiEm).toBe(18.3);
    expect(ctx!.mbiSource).toBe('sheet');
    expect(ctx!.niftyClose).toBe(22500);
    db.close();
  });

  it('upsertMarketContext updates existing entry', () => {
    const db = createInMemoryAdapter();
    const queries = new Queries(db);

    queries.upsertMarketContext({
      date: '2026-03-11',
      niftyClose: 22500,
      nifty50DMA: 22000,
      nifty200DMA: 21000,
      mbiRegime: 'BULL',
      mbiEm: 18.3,
      mbiSource: 'sheet',
      createdAt: new Date().toISOString(),
    });

    queries.upsertMarketContext({
      date: '2026-03-11',
      niftyClose: 22600,
      nifty50DMA: 22100,
      nifty200DMA: 21100,
      mbiRegime: 'CAUTIOUS',
      mbiEm: 13.0,
      mbiSource: 'breadth_only',
      createdAt: new Date().toISOString(),
    });

    const ctx = queries.getMarketContextForDate('2026-03-11');
    expect(ctx!.mbiRegime).toBe('CAUTIOUS');
    expect(ctx!.mbiEm).toBe(13.0);
    expect(ctx!.niftyClose).toBe(22600);
    db.close();
  });

  it('getLatestMarketContext returns most recent', () => {
    const db = createInMemoryAdapter();
    const queries = new Queries(db);

    queries.upsertMarketContext({
      date: '2026-03-10',
      niftyClose: 22000,
      nifty50DMA: 21500,
      nifty200DMA: 20500,
      mbiRegime: 'BEAR',
      mbiEm: 8.0,
      mbiSource: 'sheet',
      createdAt: new Date().toISOString(),
    });

    queries.upsertMarketContext({
      date: '2026-03-11',
      niftyClose: 22500,
      nifty50DMA: 22000,
      nifty200DMA: 21000,
      mbiRegime: 'BULL',
      mbiEm: 18.3,
      mbiSource: 'sheet',
      createdAt: new Date().toISOString(),
    });

    const ctx = queries.getLatestMarketContext();
    expect(ctx!.date).toBe('2026-03-11');
    expect(ctx!.mbiRegime).toBe('BULL');
    db.close();
  });

  it('getMarketContextForDate returns null for missing date', () => {
    const db = createInMemoryAdapter();
    const queries = new Queries(db);
    const ctx = queries.getMarketContextForDate('2026-01-01');
    expect(ctx).toBeNull();
    db.close();
  });
});

describe('Queries - getLatestMBIDaily alias', () => {
  it('returns same result as getLatestMBI', () => {
    const db = createInMemoryAdapter();
    const queries = new Queries(db);

    queries.upsertMBIDaily({
      date: '2026-03-11',
      capturedAt: 'eod',
      source: 'sheet',
      em: 18.3,
      pct52WH: 15,
      pct52WL: 3,
      ratio4_5: 2.5,
      dataFreshness: 'fresh',
    });

    const via1 = queries.getLatestMBI();
    const via2 = queries.getLatestMBIDaily();
    expect(via1).toEqual(via2);
    db.close();
  });
});
