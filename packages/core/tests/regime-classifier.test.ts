import { describe, it, expect } from 'vitest';
import { classifyRegime, classifyFromBreadth } from '../src/mbi/regime-classifier.js';
import type { MBIData } from '../src/models/market.js';

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
