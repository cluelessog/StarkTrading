import { describe, it, expect, mock } from 'bun:test';
import { scrapeWatchlistUrl } from '../src/api/watchlist-scraper.js';

describe('scrapeWatchlistUrl', () => {
  it('extracts NSE: prefixed symbols from HTML', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(
          '<div>NSE:RELIANCE NSE:TCS NSE:INFY</div>',
          { status: 200 },
        ),
      ),
    ) as typeof fetch;

    try {
      const result = await scrapeWatchlistUrl('https://example.com/watchlist');
      expect(result.symbols).toContain('RELIANCE');
      expect(result.symbols).toContain('TCS');
      expect(result.symbols).toContain('INFY');
      expect(result.format).toBe('tradingview');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('extracts data-symbol attributes from HTML', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(
          '<div data-symbol="NSE:HDFCBANK"></div><div data-symbol="SBIN"></div>',
          { status: 200 },
        ),
      ),
    ) as typeof fetch;

    try {
      const result = await scrapeWatchlistUrl('https://example.com/watchlist');
      expect(result.symbols).toContain('HDFCBANK');
      expect(result.symbols).toContain('SBIN');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('extracts symbols from JSON script blocks', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(
          '<script>{"symbol":"NSE:WIPRO"}</script><script>{"symbol":"ICICIBANK"}</script>',
          { status: 200 },
        ),
      ),
    ) as typeof fetch;

    try {
      const result = await scrapeWatchlistUrl('https://example.com/watchlist');
      expect(result.symbols).toContain('WIPRO');
      expect(result.symbols).toContain('ICICIBANK');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('returns empty when no symbols found and no LLM', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response('<div>No symbols here</div>', { status: 200 }),
      ),
    ) as typeof fetch;

    try {
      const result = await scrapeWatchlistUrl('https://example.com/empty');
      expect(result.symbols).toHaveLength(0);
      expect(result.format).toBe('unknown');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('throws on fetch error without LLM fallback', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() =>
      Promise.reject(new Error('Network error')),
    ) as typeof fetch;

    try {
      await expect(
        scrapeWatchlistUrl('https://example.com/fail'),
      ).rejects.toThrow('Failed to scrape');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('deduplicates symbols', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(
          '<div>NSE:RELIANCE</div><div data-symbol="NSE:RELIANCE"></div>',
          { status: 200 },
        ),
      ),
    ) as typeof fetch;

    try {
      const result = await scrapeWatchlistUrl('https://example.com/dupe');
      expect(result.symbols.filter((s) => s === 'RELIANCE')).toHaveLength(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
