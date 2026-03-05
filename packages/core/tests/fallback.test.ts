import { describe, it, expect, vi } from 'vitest';
import { withFallback } from '../src/utils/fallback.js';
import type { FallbackOption } from '../src/utils/fallback.js';

describe('withFallback', () => {
  it('returns first successful result', async () => {
    const options: FallbackOption<string>[] = [
      { name: 'primary', fn: () => Promise.resolve('primary-data') },
      { name: 'secondary', fn: () => Promise.resolve('secondary-data') },
    ];

    const result = await withFallback(options);
    expect(result.value).toBe('primary-data');
    expect(result.source).toBe('primary');
    expect(result.fallbacksAttempted).toEqual([]);
  });

  it('falls back to second option when first throws', async () => {
    const options: FallbackOption<string>[] = [
      { name: 'primary', fn: () => Promise.reject(new Error('primary failed')) },
      { name: 'secondary', fn: () => Promise.resolve('secondary-data') },
    ];

    const result = await withFallback(options);
    expect(result.value).toBe('secondary-data');
    expect(result.source).toBe('secondary');
    expect(result.fallbacksAttempted).toEqual(['primary']);
  });

  it('throws AggregateError when all options fail', async () => {
    const options: FallbackOption<string>[] = [
      { name: 'primary', fn: () => Promise.reject(new Error('primary failed')) },
      { name: 'secondary', fn: () => Promise.reject(new Error('secondary failed')) },
    ];

    await expect(withFallback(options)).rejects.toBeInstanceOf(AggregateError);
  });

  it('AggregateError contains all errors', async () => {
    const err1 = new Error('err1');
    const err2 = new Error('err2');
    const options: FallbackOption<string>[] = [
      { name: 'a', fn: () => Promise.reject(err1) },
      { name: 'b', fn: () => Promise.reject(err2) },
    ];

    let caught: AggregateError | undefined;
    try {
      await withFallback(options);
    } catch (e) {
      caught = e as AggregateError;
    }
    expect(caught).toBeInstanceOf(AggregateError);
    expect(caught!.errors).toHaveLength(2);
  });

  it('onFallback callback is called with error info', async () => {
    const onFallback = vi.fn();
    const options: FallbackOption<string>[] = [
      { name: 'primary', fn: () => Promise.reject(new Error('primary failed')) },
      { name: 'secondary', fn: () => Promise.resolve('ok') },
    ];

    await withFallback(options, onFallback);

    expect(onFallback).toHaveBeenCalledTimes(1);
    expect(onFallback).toHaveBeenCalledWith('primary', expect.any(Error));
  });

  it('onFallback is called for each failure before AggregateError', async () => {
    const onFallback = vi.fn();
    const options: FallbackOption<string>[] = [
      { name: 'a', fn: () => Promise.reject(new Error('a failed')) },
      { name: 'b', fn: () => Promise.reject(new Error('b failed')) },
    ];

    await expect(withFallback(options, onFallback)).rejects.toBeInstanceOf(AggregateError);
    expect(onFallback).toHaveBeenCalledTimes(2);
  });
});
