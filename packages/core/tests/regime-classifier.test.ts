import { describe, it, expect } from 'vitest';
import { classifyRegime, classifyFromBreadth, classifyRegimeFull, getFocusParams } from '../src/mbi/regime-classifier.js';
import type { MBIData, EMThresholds } from '../src/models/market.js';

describe('classifyRegime', () => {
  it('classifies STRONG_BULL when EM >= 25', () => {
    expect(classifyRegime(30)).toBe('STRONG_BULL');
    expect(classifyRegime(25)).toBe('STRONG_BULL');
  });

  it('classifies BULL when EM >= 15', () => {
    expect(classifyRegime(20)).toBe('BULL');
    expect(classifyRegime(15)).toBe('BULL');
  });

  it('classifies CAUTIOUS when EM 12-15', () => {
    expect(classifyRegime(13)).toBe('CAUTIOUS');
    expect(classifyRegime(12)).toBe('CAUTIOUS');
  });

  it('classifies CHOPPY when EM 9.5-12', () => {
    expect(classifyRegime(10)).toBe('CHOPPY');
    expect(classifyRegime(9.5)).toBe('CHOPPY');
  });

  it('classifies BEAR when EM < 9.5', () => {
    expect(classifyRegime(5)).toBe('BEAR');
    expect(classifyRegime(0)).toBe('BEAR');
  });

  it('returns CAUTIOUS when EM is null', () => {
    expect(classifyRegime(null)).toBe('CAUTIOUS');
    expect(classifyRegime(undefined)).toBe('CAUTIOUS');
  });
});

describe('classifyFromBreadth', () => {
  const baseMBI: MBIData = {
    date: '2026-03-06',
    capturedAt: 'eod',
    source: 'chartink',
    em: null,
    pct52WH: 0,
    pct52WL: 0,
    ratio4_5: 0,
    fetchedAt: new Date().toISOString(),
    dataFreshness: 'fresh',
  };

  it('classifies BULL with strong breadth', () => {
    expect(classifyFromBreadth({
      ...baseMBI,
      pct52WH: 25,
      pct52WL: 5,
      pctAbove200SMA: 70,
    })).toBe('BULL');
  });

  it('classifies BEAR with weak breadth', () => {
    expect(classifyFromBreadth({
      ...baseMBI,
      pct52WH: 3,
      pct52WL: 25,
      pctAbove200SMA: 30,
    })).toBe('BEAR');
  });

  it('never returns STRONG_BULL (conservative bias)', () => {
    const result = classifyFromBreadth({
      ...baseMBI,
      pct52WH: 50,
      pct52WL: 1,
      pctAbove200SMA: 90,
    });
    expect(result).not.toBe('STRONG_BULL');
  });
});

// ---------------------------------------------------------------------------
// classifyRegimeFull
// ---------------------------------------------------------------------------

describe('classifyRegimeFull', () => {
  const baseMBI: MBIData = {
    date: '2026-03-11',
    capturedAt: 'eod',
    source: 'sheet',
    em: null,
    pct52WH: 0,
    pct52WL: 0,
    ratio4_5: 0,
    fetchedAt: new Date().toISOString(),
    dataFreshness: 'fresh',
  };

  it('uses EM thresholds when EM is available', () => {
    const result = classifyRegimeFull({ ...baseMBI, em: 18.3 });
    expect(result.regime).toBe('BULL');
    expect(result.em).toBe(18.3);
    expect(result.confidence).toBe('full');
    expect(result.source).toBe('sheet');
  });

  it('classifies STRONG_BULL with high EM', () => {
    const result = classifyRegimeFull({ ...baseMBI, em: 30 });
    expect(result.regime).toBe('STRONG_BULL');
    expect(result.confidence).toBe('full');
  });

  it('classifies BEAR with low EM', () => {
    const result = classifyRegimeFull({ ...baseMBI, em: 5 });
    expect(result.regime).toBe('BEAR');
  });

  it('EM boundary: 9.4 -> BEAR, 9.5 -> CHOPPY', () => {
    expect(classifyRegimeFull({ ...baseMBI, em: 9.4 }).regime).toBe('BEAR');
    expect(classifyRegimeFull({ ...baseMBI, em: 9.5 }).regime).toBe('CHOPPY');
  });

  it('EM boundary: 12 -> CAUTIOUS, 15 -> BULL, 25 -> STRONG_BULL', () => {
    expect(classifyRegimeFull({ ...baseMBI, em: 12 }).regime).toBe('CAUTIOUS');
    expect(classifyRegimeFull({ ...baseMBI, em: 15 }).regime).toBe('BULL');
    expect(classifyRegimeFull({ ...baseMBI, em: 25 }).regime).toBe('STRONG_BULL');
  });

  it('delegates to breadth classifier when EM is null', () => {
    const result = classifyRegimeFull({
      ...baseMBI,
      em: null,
      source: 'breadth_only',
      pct52WH: 25,
      pct52WL: 5,
      pctAbove200SMA: 65,
      pctAbove50SMA: 60,
    });
    expect(result.regime).toBe('BULL');
    expect(result.em).toBeNull();
    expect(result.confidence).toBe('breadth_only');
    expect(result.source).toBe('breadth_only');
  });

  it('breadth-only never returns STRONG_BULL', () => {
    const result = classifyRegimeFull({
      ...baseMBI,
      em: null,
      source: 'breadth_only',
      pct52WH: 60,
      pct52WL: 0,
      pctAbove200SMA: 95,
      pctAbove50SMA: 95,
    });
    expect(result.regime).not.toBe('STRONG_BULL');
  });

  it('returns stale confidence when data freshness is stale', () => {
    const result = classifyRegimeFull({
      ...baseMBI,
      em: 18,
      dataFreshness: 'stale',
      source: 'stale_cache',
    });
    expect(result.regime).toBe('BULL');
    expect(result.confidence).toBe('stale');
  });

  it('respects custom thresholds', () => {
    const custom: EMThresholds = {
      strongBull: 30,
      bull: 20,
      cautious: 15,
      choppy: 10,
    };
    // EM=18 would be BULL with defaults, but CAUTIOUS with custom
    const result = classifyRegimeFull({ ...baseMBI, em: 18 }, custom);
    expect(result.regime).toBe('CAUTIOUS');
  });

  it('breadth-only BEAR with weak breadth', () => {
    const result = classifyRegimeFull({
      ...baseMBI,
      em: null,
      source: 'breadth_only',
      pct52WH: 3,
      pct52WL: 25,
      pctAbove200SMA: 30,
      pctAbove50SMA: 25,
    });
    expect(result.regime).toBe('BEAR');
    expect(result.confidence).toBe('breadth_only');
  });
});

// ---------------------------------------------------------------------------
// getFocusParams
// ---------------------------------------------------------------------------

describe('getFocusParams', () => {
  it('returns correct params for STRONG_BULL', () => {
    const params = getFocusParams('STRONG_BULL');
    expect(params.threshold).toBe(7.5);
    expect(params.maxStocks).toBe(12);
  });

  it('returns correct params for BULL', () => {
    const params = getFocusParams('BULL');
    expect(params.threshold).toBe(8.0);
    expect(params.maxStocks).toBe(10);
  });

  it('returns correct params for CAUTIOUS', () => {
    const params = getFocusParams('CAUTIOUS');
    expect(params.threshold).toBe(8.5);
    expect(params.maxStocks).toBe(8);
  });

  it('returns correct params for CHOPPY', () => {
    const params = getFocusParams('CHOPPY');
    expect(params.threshold).toBe(9.0);
    expect(params.maxStocks).toBe(5);
  });

  it('returns correct params for BEAR', () => {
    const params = getFocusParams('BEAR');
    expect(params.threshold).toBe(10.0);
    expect(params.maxStocks).toBe(3);
  });

  it('returns a copy (not a reference)', () => {
    const a = getFocusParams('BULL');
    const b = getFocusParams('BULL');
    a.threshold = 99;
    expect(b.threshold).toBe(8.0);
  });
});
