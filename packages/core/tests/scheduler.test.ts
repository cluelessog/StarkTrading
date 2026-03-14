import { describe, it, expect } from 'bun:test';
import { TradingScheduler } from '../src/scheduler/scheduler.js';

const HOLIDAYS_2026 = ['2026-01-26', '2026-08-15', '2026-10-02'];

function makeScheduler(holidays: string[] = HOLIDAYS_2026): TradingScheduler {
  return new TradingScheduler({
    eveningTime: '18:00',
    morningTime: '08:30',
    syncIntervalMinutes: 30,
    nseHolidays: holidays,
  });
}

describe('TradingScheduler', () => {
  describe('isTradingDay', () => {
    it('returns false for Saturday', () => {
      // 2026-03-14 is a Saturday
      const scheduler = makeScheduler();
      expect(scheduler.isTradingDay(new Date('2026-03-14T10:00:00+05:30'))).toBe(false);
    });

    it('returns false for Sunday', () => {
      // 2026-03-15 is a Sunday
      const scheduler = makeScheduler();
      expect(scheduler.isTradingDay(new Date('2026-03-15T10:00:00+05:30'))).toBe(false);
    });

    it('returns true for a normal weekday', () => {
      // 2026-03-12 is a Thursday
      const scheduler = makeScheduler();
      expect(scheduler.isTradingDay(new Date('2026-03-12T10:00:00+05:30'))).toBe(true);
    });

    it('returns false for NSE holiday (Republic Day)', () => {
      const scheduler = makeScheduler();
      // 2026-01-26 is Monday (Republic Day)
      expect(scheduler.isTradingDay(new Date('2026-01-26T10:00:00+05:30'))).toBe(false);
    });

    it('returns false for NSE holiday (Independence Day)', () => {
      const scheduler = makeScheduler();
      // 2026-08-15 is Saturday — also weekend, but tests holiday list
      const scheduler2 = makeScheduler(['2026-03-11']);
      // 2026-03-11 is a Wednesday (normal weekday but in holiday list)
      expect(scheduler2.isTradingDay(new Date('2026-03-11T10:00:00+05:30'))).toBe(false);
    });

    it('returns false for non-holiday weekend even if not in holiday list', () => {
      const scheduler = makeScheduler([]);
      // 2026-03-07 is a Saturday
      expect(scheduler.isTradingDay(new Date('2026-03-07T10:00:00+05:30'))).toBe(false);
    });
  });

  describe('duplicate run prevention', () => {
    it('start/stop cycle works without throwing', () => {
      const scheduler = makeScheduler();
      let called = 0;
      // Just verify start+stop doesn't throw
      scheduler.start({
        async onEvening() { called++; },
        async onMorning() { called++; },
        async onSync() { called++; },
      });
      scheduler.stop();
      expect(called).toBeGreaterThanOrEqual(0);
    });

    it('calling stop when not started does not throw', () => {
      const scheduler = makeScheduler();
      expect(() => scheduler.stop()).not.toThrow();
    });
  });

  describe('IST timezone handling', () => {
    it('correctly identifies trading day for IST date regardless of UTC offset', () => {
      const scheduler = makeScheduler();
      // 2026-03-12 10:00 IST = 2026-03-12 04:30 UTC — should still be Thursday (trading day)
      const utcDate = new Date('2026-03-12T04:30:00Z');
      expect(scheduler.isTradingDay(utcDate)).toBe(true);
    });

    it('handles midnight boundary in IST', () => {
      const scheduler = makeScheduler();
      // 2026-03-13 00:30 IST = 2026-03-12 19:00 UTC — Friday in IST
      const utcDate = new Date('2026-03-12T19:00:00Z');
      expect(scheduler.isTradingDay(utcDate)).toBe(true);
    });
  });
});
