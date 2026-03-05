import { describe, it, expect } from 'vitest';
import {
  isTradingDay,
  previousTradingDay,
  nextTradingDay,
  tradingDaysBetween,
} from '../src/utils/trading-calendar.js';

describe('isTradingDay', () => {
  it('returns true for a weekday non-holiday (2026-03-05 Thursday)', () => {
    expect(isTradingDay('2026-03-05')).toBe(true);
  });

  it('returns false for Saturday (2026-03-07)', () => {
    expect(isTradingDay('2026-03-07')).toBe(false);
  });

  it('returns false for Sunday (2026-03-08)', () => {
    expect(isTradingDay('2026-03-08')).toBe(false);
  });

  it('returns false for NSE holiday Republic Day (2026-01-26)', () => {
    expect(isTradingDay('2026-01-26')).toBe(false);
  });
});

describe('previousTradingDay', () => {
  it('from Monday (2026-03-09) returns Friday (2026-03-06) skipping weekend', () => {
    expect(previousTradingDay('2026-03-09')).toBe('2026-03-06');
  });

  it('skips Maha Shivaratri holiday: from 2026-03-11 skips 2026-03-10', () => {
    // 2026-03-10 is Maha Shivaratri (holiday), 2026-03-09 is Monday (trading day)
    expect(previousTradingDay('2026-03-11')).toBe('2026-03-09');
  });
});

describe('nextTradingDay', () => {
  it('from Friday (2026-03-06) returns Monday (2026-03-09)', () => {
    expect(nextTradingDay('2026-03-06')).toBe('2026-03-09');
  });
});

describe('tradingDaysBetween', () => {
  it('counts correctly excluding weekends and holidays', () => {
    // from 2026-03-05 (Thu) to 2026-03-12 (Thu)
    // 2026-03-06 Fri: trading
    // 2026-03-07 Sat: skip
    // 2026-03-08 Sun: skip
    // 2026-03-09 Mon: trading
    // 2026-03-10 Tue: holiday (Maha Shivaratri) skip
    // 2026-03-11 Wed: trading
    // total = 3
    expect(tradingDaysBetween('2026-03-05', '2026-03-12')).toBe(3);
  });

  it('returns 0 when from and to are adjacent trading days', () => {
    // from Mon to Tue with no holidays between
    expect(tradingDaysBetween('2026-03-05', '2026-03-06')).toBe(0);
  });
});
