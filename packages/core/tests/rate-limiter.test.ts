import { describe, it, expect } from 'vitest';
import { RateLimiter } from '../src/utils/rate-limiter.js';

describe('RateLimiter.execute', () => {
  it('runs the function and returns result', async () => {
    const limiter = new RateLimiter(0);
    const result = await limiter.execute(() => Promise.resolve(42));
    expect(result).toBe(42);
  });

  it('returns string results correctly', async () => {
    const limiter = new RateLimiter(0);
    const result = await limiter.execute(() => Promise.resolve('hello'));
    expect(result).toBe('hello');
  });

  it('respects minimum interval between calls', async () => {
    const intervalMs = 100;
    const limiter = new RateLimiter(intervalMs);

    const timestamps: number[] = [];
    const fn = () => {
      timestamps.push(Date.now());
      return Promise.resolve(true);
    };

    // Queue two calls concurrently
    await Promise.all([
      limiter.execute(fn),
      limiter.execute(fn),
    ]);

    expect(timestamps).toHaveLength(2);
    const elapsed = timestamps[1] - timestamps[0];
    // Should be at least intervalMs apart
    expect(elapsed).toBeGreaterThanOrEqual(intervalMs - 10); // small tolerance
  }, 10000);
});
