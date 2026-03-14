import { describe, it, expect } from 'bun:test';
import { getNifty50Constituents } from '../src/market/nifty-constituents.js';
import { classifyFromBreadthDetailed } from '../src/market/fallback-classifier.js';
import { BreadthCalculator } from '../src/market/breadth-calculator.js';
import type { BreadthCalculatorConfig } from '../src/market/breadth-calculator.js';
import type { BreadthData } from '../src/models/market.js';
import type { OHLCVBar } from '../src/models/intervals.js';
import type { DataProvider } from '../src/api/data-provider.js';
import type { DatabaseAdapter } from '../src/db/adapter.js';
import { MIGRATIONS } from '../src/db/schema.js';
import { Database } from 'bun:sqlite';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createInMemoryAdapter(): DatabaseAdapter {
  const db = new Database(':memory:');
  for (const migration of MIGRATIONS) {
    db.exec(migration.sql);
  }
  return {
    execute(sql: string, params: unknown[] = []) {
      db.prepare(sql).run(...params);
    },
    execMulti(sql: string) {
      db.exec(sql);
    },
    query<T>(sql: string, params: unknown[] = []): T[] {
      return db.prepare(sql).all(...params) as T[];
    },
    queryOne<T>(sql: string, params: unknown[] = []): T | null {
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

function makeBars(closes: number[], startDate = '2025-01-01'): OHLCVBar[] {
  return closes.map((close, i) => {
    const d = new Date(startDate);
    d.setDate(d.getDate() + i);
    return {
      timestamp: d.toISOString().slice(0, 10),
      open: close * 0.99,
      high: close * 1.01,
      low: close * 0.98,
      close,
      volume: 100000,
    };
  });
}

function createMockProvider(barsMap: Map<string, OHLCVBar[]>): DataProvider {
  return {
    name: 'mock',
    async authenticate() {},
    isAuthenticated() { return true; },
    async dispose() {},
    async fetchOHLCV(symbol: string) {
      return barsMap.get(symbol) ?? [];
    },
    async fetchQuote() {
      return { symbol: '', token: '', ltp: 0, open: 0, high: 0, low: 0, close: 0, volume: 0, timestamp: '' };
    },
    async fetchQuotes() { return []; },
    async searchSymbol() { return []; },
    async getInstrumentMaster() { return []; },
  };
}

// ---------------------------------------------------------------------------
// getNifty50Constituents
// ---------------------------------------------------------------------------

describe('getNifty50Constituents', () => {
  it('returns 50 symbols', () => {
    const constituents = getNifty50Constituents();
    expect(constituents).toHaveLength(50);
  });

  it('returns copies (not references to the internal array)', () => {
    const a = getNifty50Constituents();
    const b = getNifty50Constituents();
    a[0].symbol = 'MUTATED';
    expect(b[0].symbol).not.toBe('MUTATED');
  });
});

// ---------------------------------------------------------------------------
// classifyFromBreadthDetailed
// ---------------------------------------------------------------------------

describe('classifyFromBreadthDetailed', () => {
  it('classifies BULL with strong breadth (high 52WH, low 52WL, high >200SMA)', () => {
    const data: BreadthData = {
      pct52WH: 25,
      pct52WL: 5,
      pctAbove50SMA: 70,
      pctAbove200SMA: 65,
    };
    const result = classifyFromBreadthDetailed(data);
    expect(result.regime).toBe('BULL');
    expect(result.confidence).toBe('breadth_only');
    expect(result.reason).toContain('52WH');
  });

  it('classifies BEAR with weak breadth (low 52WH, high 52WL)', () => {
    const data: BreadthData = {
      pct52WH: 3,
      pct52WL: 25,
      pctAbove50SMA: 30,
      pctAbove200SMA: 35,
    };
    const result = classifyFromBreadthDetailed(data);
    expect(result.regime).toBe('BEAR');
    expect(result.confidence).toBe('breadth_only');
  });

  it('classifies BEAR when pctAbove200SMA < 40', () => {
    const data: BreadthData = {
      pct52WH: 10,
      pct52WL: 10,
      pctAbove50SMA: 40,
      pctAbove200SMA: 35,
    };
    const result = classifyFromBreadthDetailed(data);
    expect(result.regime).toBe('BEAR');
  });

  it('classifies CHOPPY with mixed signals', () => {
    const data: BreadthData = {
      pct52WH: 8,
      pct52WL: 8,
      pctAbove50SMA: 45,
      pctAbove200SMA: 45,
    };
    const result = classifyFromBreadthDetailed(data);
    expect(result.regime).toBe('CHOPPY');
  });

  it('classifies CAUTIOUS with moderate breadth', () => {
    const data: BreadthData = {
      pct52WH: 15,
      pct52WL: 8,
      pctAbove50SMA: 55,
      pctAbove200SMA: 55,
    };
    const result = classifyFromBreadthDetailed(data);
    expect(result.regime).toBe('CAUTIOUS');
  });

  it('never returns STRONG_BULL', () => {
    // Even with extremely bullish breadth data
    const data: BreadthData = {
      pct52WH: 60,
      pct52WL: 0,
      pctAbove50SMA: 95,
      pctAbove200SMA: 95,
    };
    const result = classifyFromBreadthDetailed(data);
    expect(result.regime).not.toBe('STRONG_BULL');
  });
});

// ---------------------------------------------------------------------------
// BreadthCalculator.calculateSMA
// ---------------------------------------------------------------------------

describe('BreadthCalculator.calculateSMA', () => {
  it('returns correct average for given period', () => {
    const db = createInMemoryAdapter();
    const constituents = [{ symbol: 'TEST', token: '0' }];
    const config: BreadthCalculatorConfig = {
      universe: 'NIFTY50',
      nifty50Constituents: constituents,
    };
    const provider = createMockProvider(new Map());
    const calc = new BreadthCalculator(provider, db, config);

    const bars = makeBars([10, 20, 30, 40, 50]);
    // SMA(3) of last 3 bars: (30+40+50)/3 = 40
    const sma = calc.calculateSMA(bars, 3);
    expect(sma).toBe(40);
    db.close();
  });

  it('returns null when bars < period', () => {
    const db = createInMemoryAdapter();
    const config: BreadthCalculatorConfig = {
      universe: 'NIFTY50',
      nifty50Constituents: [{ symbol: 'TEST', token: '0' }],
    };
    const provider = createMockProvider(new Map());
    const calc = new BreadthCalculator(provider, db, config);

    const bars = makeBars([10, 20]);
    const sma = calc.calculateSMA(bars, 5);
    expect(sma).toBeNull();
    db.close();
  });
});

// ---------------------------------------------------------------------------
// BreadthCalculator.is52WeekHigh / is52WeekLow
// ---------------------------------------------------------------------------

describe('BreadthCalculator.is52WeekHigh', () => {
  it('returns true when latest close equals max in lookback', () => {
    const db = createInMemoryAdapter();
    const config: BreadthCalculatorConfig = {
      universe: 'NIFTY50',
      nifty50Constituents: [{ symbol: 'TEST', token: '0' }],
    };
    const provider = createMockProvider(new Map());
    const calc = new BreadthCalculator(provider, db, config);

    // Rising prices: last close is the highest
    const bars = makeBars([100, 110, 120, 130, 140]);
    expect(calc.is52WeekHigh(bars)).toBe(true);
    db.close();
  });

  it('returns false when latest close is below max', () => {
    const db = createInMemoryAdapter();
    const config: BreadthCalculatorConfig = {
      universe: 'NIFTY50',
      nifty50Constituents: [{ symbol: 'TEST', token: '0' }],
    };
    const provider = createMockProvider(new Map());
    const calc = new BreadthCalculator(provider, db, config);

    // Price drops at end
    const bars = makeBars([100, 150, 140, 130, 120]);
    expect(calc.is52WeekHigh(bars)).toBe(false);
    db.close();
  });

  it('returns false with fewer than 2 bars', () => {
    const db = createInMemoryAdapter();
    const config: BreadthCalculatorConfig = {
      universe: 'NIFTY50',
      nifty50Constituents: [{ symbol: 'TEST', token: '0' }],
    };
    const provider = createMockProvider(new Map());
    const calc = new BreadthCalculator(provider, db, config);

    expect(calc.is52WeekHigh(makeBars([100]))).toBe(false);
    expect(calc.is52WeekHigh([])).toBe(false);
    db.close();
  });
});

describe('BreadthCalculator.is52WeekLow', () => {
  it('returns true when latest close equals min in lookback', () => {
    const db = createInMemoryAdapter();
    const config: BreadthCalculatorConfig = {
      universe: 'NIFTY50',
      nifty50Constituents: [{ symbol: 'TEST', token: '0' }],
    };
    const provider = createMockProvider(new Map());
    const calc = new BreadthCalculator(provider, db, config);

    // Falling prices: last close is the lowest
    const bars = makeBars([150, 140, 130, 120, 110]);
    expect(calc.is52WeekLow(bars)).toBe(true);
    db.close();
  });

  it('returns false when latest close is above min', () => {
    const db = createInMemoryAdapter();
    const config: BreadthCalculatorConfig = {
      universe: 'NIFTY50',
      nifty50Constituents: [{ symbol: 'TEST', token: '0' }],
    };
    const provider = createMockProvider(new Map());
    const calc = new BreadthCalculator(provider, db, config);

    const bars = makeBars([100, 90, 95, 105, 110]);
    expect(calc.is52WeekLow(bars)).toBe(false);
    db.close();
  });
});

// ---------------------------------------------------------------------------
// BreadthCalculator.calculateBreadth — zero successful stocks
// ---------------------------------------------------------------------------

describe('BreadthCalculator.calculateBreadth', () => {
  it('returns safe defaults when zero stocks fetch successfully', async () => {
    const db = createInMemoryAdapter();
    const constituents = [
      { symbol: 'FAIL1', token: '0' },
      { symbol: 'FAIL2', token: '0' },
    ];
    const config: BreadthCalculatorConfig = {
      universe: 'NIFTY50',
      nifty50Constituents: constituents,
    };
    // Provider returns empty bars for all symbols
    const provider = createMockProvider(new Map());
    const calc = new BreadthCalculator(provider, db, config);

    const result = await calc.calculateBreadth();
    expect(result.successfulStocks).toBe(0);
    expect(result.totalStocks).toBe(2);
    expect(result.pct52WH).toBe(0);
    expect(result.pct52WL).toBe(0);
    expect(result.pctAbove200SMA).toBe(0);
    expect(result.pctBelow200SMA).toBe(100);
    expect(result.failedStocks).toContain('FAIL1');
    expect(result.failedStocks).toContain('FAIL2');
    db.close();
  });

  it('computes breadth indicators from provided OHLCV data', async () => {
    const db = createInMemoryAdapter();
    // Create 2 constituents with known data
    const constituents = [
      { symbol: 'STOCK_A', token: '100' },
      { symbol: 'STOCK_B', token: '200' },
    ];

    // STOCK_A: rising to new high over 250 bars (close goes from 100 to 350)
    const closesA: number[] = [];
    for (let i = 0; i < 260; i++) closesA.push(100 + i);
    const barsA = makeBars(closesA);

    // STOCK_B: falling to new low over 260 bars (close goes from 300 to 41)
    const closesB: number[] = [];
    for (let i = 0; i < 260; i++) closesB.push(300 - i);
    const barsB = makeBars(closesB);

    const barsMap = new Map<string, OHLCVBar[]>();
    barsMap.set('STOCK_A', barsA);
    barsMap.set('STOCK_B', barsB);

    const config: BreadthCalculatorConfig = {
      universe: 'NIFTY50',
      nifty50Constituents: constituents,
    };
    const provider = createMockProvider(barsMap);
    const calc = new BreadthCalculator(provider, db, config);

    const result = await calc.calculateBreadth();
    expect(result.successfulStocks).toBe(2);
    expect(result.totalStocks).toBe(2);
    // STOCK_A is at 52-week high, STOCK_B is at 52-week low
    expect(result.pct52WH).toBe(50); // 1 of 2
    expect(result.pct52WL).toBe(50); // 1 of 2
    expect(result.failedStocks).toHaveLength(0);
    db.close();
  });
});
