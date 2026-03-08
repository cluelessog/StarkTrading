import { describe, it, expect, afterEach, setSystemTime } from 'bun:test';
import { OHLCVCache } from '../src/cache/ohlcv-cache.js';
import type { OHLCVBar } from '../src/models/intervals.js';

afterEach(() => {
  setSystemTime();
});

function makeQueries(meta?: { fetchedAt: string }) {
  return {
    getOHLCV: (_symbol: string, _interval: string, _from: string, _to: string): OHLCVBar[] => [],
    upsertOHLCV: (_symbol: string, _interval: string, _bars: OHLCVBar[]): void => {},
    getOHLCVMeta: (_symbol: string, _interval: string) => meta,
  };
}

describe('OHLCVCache.isFresh', () => {
  it('returns true when fetchedAt is after today 15:30 IST (10:00 UTC)', () => {
    // Simulate "now" as 2026-03-05 11:00 UTC (which is IST 16:30, after market close)
    setSystemTime(new Date('2026-03-05T11:00:00.000Z'));

    const cache = new OHLCVCache(makeQueries());
    // fetchedAt is 10:30 UTC (15:30 + 1 hour = after close)
    expect(cache.isFresh('2026-03-05T10:30:00.000Z')).toBe(true);
  });

  it('returns false when fetchedAt is before today 15:30 IST (10:00 UTC)', () => {
    setSystemTime(new Date('2026-03-05T11:00:00.000Z'));

    const cache = new OHLCVCache(makeQueries());
    // fetchedAt is 09:00 UTC (before market close)
    expect(cache.isFresh('2026-03-05T09:00:00.000Z')).toBe(false);
  });
});

describe('OHLCVCache.get', () => {
  it('returns data with stale freshness when no meta exists', async () => {
    setSystemTime(new Date('2026-03-05T11:00:00.000Z'));

    const cache = new OHLCVCache(makeQueries(undefined));
    const result = await cache.get('RELIANCE', '1d', '2026-03-01', '2026-03-05');
    expect(result.freshness).toBe('stale');
    expect(Array.isArray(result.bars)).toBe(true);
  });
});
