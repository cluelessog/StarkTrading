import { describe, it, expect } from 'vitest';
import { MockProvider } from '../src/api/mock-provider.js';

describe('MockProvider', () => {
  it('authenticates successfully', async () => {
    const provider = new MockProvider();
    expect(provider.isAuthenticated()).toBe(false);
    await provider.authenticate({ user: 'test' });
    expect(provider.isAuthenticated()).toBe(true);
  });

  it('disposes and deauthenticates', async () => {
    const provider = new MockProvider();
    await provider.authenticate({});
    expect(provider.isAuthenticated()).toBe(true);
    await provider.dispose();
    expect(provider.isAuthenticated()).toBe(false);
  });

  it('fetches OHLCV bars for a date range', async () => {
    const provider = new MockProvider();
    const bars = await provider.fetchOHLCV('RELIANCE', '2885', '1d', '2026-01-01', '2026-01-10');
    expect(bars.length).toBeGreaterThan(0);
    for (const bar of bars) {
      expect(bar).toHaveProperty('timestamp');
      expect(bar).toHaveProperty('open');
      expect(bar).toHaveProperty('high');
      expect(bar).toHaveProperty('low');
      expect(bar).toHaveProperty('close');
      expect(bar).toHaveProperty('volume');
      expect(bar.high).toBeGreaterThanOrEqual(bar.low);
    }
  });

  it('fetches a single quote', async () => {
    const provider = new MockProvider();
    const quote = await provider.fetchQuote('RELIANCE', '2885');
    expect(quote.symbol).toBe('RELIANCE');
    expect(quote.token).toBe('2885');
    expect(quote.ltp).toBeGreaterThan(0);
    expect(quote.volume).toBeGreaterThan(0);
  });

  it('fetches multiple quotes', async () => {
    const provider = new MockProvider();
    const quotes = await provider.fetchQuotes([
      { symbol: 'RELIANCE', token: '2885' },
      { symbol: 'TCS', token: '11536' },
    ]);
    expect(quotes).toHaveLength(2);
    expect(quotes[0].symbol).toBe('RELIANCE');
    expect(quotes[1].symbol).toBe('TCS');
  });

  it('searches symbols by name', async () => {
    const provider = new MockProvider();
    const results = await provider.searchSymbol('RELIANCE');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].symbol).toBe('RELIANCE');
  });

  it('searches symbols case-insensitively', async () => {
    const provider = new MockProvider();
    const results = await provider.searchSymbol('bank');
    expect(results.length).toBeGreaterThan(0);
    // Should find HDFCBANK, ICICIBANK, KOTAKBANK, SBIN (State Bank)
    const symbols = results.map((r) => r.symbol);
    expect(symbols).toContain('HDFCBANK');
  });

  it('returns full instrument master', async () => {
    const provider = new MockProvider();
    const instruments = await provider.getInstrumentMaster();
    expect(instruments.length).toBe(10);
    const reliance = instruments.find((i) => i.symbol === 'RELIANCE');
    expect(reliance).toBeDefined();
    expect(reliance!.token).toBe('2885');
    expect(reliance!.sector).toBe('Energy');
  });

  it('filters instrument master by exchange', async () => {
    const provider = new MockProvider();
    const nse = await provider.getInstrumentMaster('NSE');
    expect(nse.length).toBe(10);
    const bse = await provider.getInstrumentMaster('BSE');
    expect(bse.length).toBe(0);
  });
});
