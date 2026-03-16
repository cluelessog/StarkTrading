import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { ChartinkClient } from '../src/api/chartink.js';
import type { ChartinkConfig } from '../src/api/chartink.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: ChartinkConfig = {
  dashboardId: '291317',
  timeoutMs: 10000,
};

const CSRF_HTML = `
<!DOCTYPE html>
<html>
<head>
  <meta name="csrf-token" content="test-csrf-token-abc123">
</head>
<body>Chartink Screener</body>
</html>
`;

function makeProcessResponse(count: number) {
  const data = Array.from({ length: count }, (_, i) => ({
    nsecode: `STOCK${i}`,
    name: `Stock ${i}`,
    close: 100 + i,
  }));
  return { data };
}

/**
 * Build a mock fetch that:
 * - Returns CSRF HTML for GET /screener/
 * - Returns scan results for POST /screener/process (configurable per scan)
 */
function createMockFetch(scanCounts: {
  above200SMA?: number;
  above50SMA?: number;
  above20SMA?: number;
  high52W?: number;
  low52W?: number;
  totalNSE?: number;
}) {
  const defaults = {
    above200SMA: 650,
    above50SMA: 550,
    above20SMA: 600,
    high52W: 150,
    low52W: 50,
    totalNSE: 1000,
    ...scanCounts,
  };

  // Track which scan is being called (they arrive sequentially)
  let scanIndex = 0;
  const scanOrder = [
    defaults.above200SMA,
    defaults.above50SMA,
    defaults.above20SMA,
    defaults.high52W,
    defaults.low52W,
    defaults.totalNSE,
  ];

  return async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

    // Session init — return CSRF HTML
    if (url.includes('/screener/') && (!init?.method || init.method === 'GET')) {
      return new Response(CSRF_HTML, {
        status: 200,
        headers: {
          'Content-Type': 'text/html',
          'Set-Cookie': 'chartink_session=fake123; Path=/',
        },
      });
    }

    // Scan process — return stock data
    if (url.includes('/screener/process') && init?.method === 'POST') {
      const count = scanOrder[scanIndex] ?? 0;
      scanIndex++;
      return new Response(JSON.stringify(makeProcessResponse(count)), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response('Not found', { status: 404 });
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ChartinkClient', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('fetches breadth data with correct percentages', async () => {
    globalThis.fetch = createMockFetch({
      above200SMA: 650,
      above50SMA: 550,
      above20SMA: 600,
      high52W: 150,
      low52W: 50,
      totalNSE: 1000,
    }) as typeof fetch;

    const client = new ChartinkClient(DEFAULT_CONFIG);
    const result = await client.fetchBreadthData();

    expect(result.pctAbove200SMA).toBe(65);
    expect(result.pctAbove50SMA).toBe(55);
    expect(result.pctAbove20SMA).toBe(60);
    expect(result.pct52WH).toBe(15);
    expect(result.pct52WL).toBe(5);
    expect(result.fetchedAt).toBeTruthy();
    expect(result.rawHtml).toBeTruthy();
  });

  it('computes ratio4_5 as advancers/decliners', async () => {
    globalThis.fetch = createMockFetch({
      above200SMA: 600,
      totalNSE: 1000,
    }) as typeof fetch;

    const client = new ChartinkClient(DEFAULT_CONFIG);
    const result = await client.fetchBreadthData();

    // ratio = above200SMA / (totalNSE - above200SMA) = 600/400 = 1.5
    expect(result.ratio4_5).toBe(1.5);
  });

  it('throws when total NSE count is 0', async () => {
    globalThis.fetch = createMockFetch({
      totalNSE: 0,
    }) as typeof fetch;

    const client = new ChartinkClient(DEFAULT_CONFIG);
    await expect(client.fetchBreadthData()).rejects.toThrow(
      'Chartink returned 0 total NSE stocks',
    );
  });

  it('throws when CSRF token is missing from page', async () => {
    globalThis.fetch = (async () => {
      return new Response('<html><head></head><body></body></html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      });
    }) as typeof fetch;

    const client = new ChartinkClient(DEFAULT_CONFIG);
    await expect(client.fetchBreadthData()).rejects.toThrow(
      'Could not extract CSRF token',
    );
  });

  it('throws when session init returns non-200', async () => {
    globalThis.fetch = (async () => {
      return new Response('Service Unavailable', { status: 503 });
    }) as typeof fetch;

    const client = new ChartinkClient(DEFAULT_CONFIG);
    await expect(client.fetchBreadthData()).rejects.toThrow(
      'Chartink session init HTTP 503',
    );
  });

  it('throws when scan process returns non-200', async () => {
    let callCount = 0;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

      if (url.includes('/screener/') && (!init?.method || init.method === 'GET')) {
        return new Response(CSRF_HTML, {
          status: 200,
          headers: { 'Content-Type': 'text/html' },
        });
      }

      // First POST fails
      callCount++;
      return new Response('Rate limited', { status: 429 });
    }) as typeof fetch;

    const client = new ChartinkClient(DEFAULT_CONFIG);
    await expect(client.fetchBreadthData()).rejects.toThrow('Chartink scan HTTP 429');
  });

  it('stores raw counts in rawHtml field', async () => {
    globalThis.fetch = createMockFetch({
      above200SMA: 700,
      above50SMA: 600,
      above20SMA: 650,
      high52W: 120,
      low52W: 80,
      totalNSE: 1200,
    }) as typeof fetch;

    const client = new ChartinkClient(DEFAULT_CONFIG);
    const result = await client.fetchBreadthData();

    const raw = JSON.parse(result.rawHtml!);
    expect(raw.above200SMA).toBe(700);
    expect(raw.above50SMA).toBe(600);
    expect(raw.above20SMA).toBe(650);
    expect(raw.high52W).toBe(120);
    expect(raw.low52W).toBe(80);
    expect(raw.totalNSE).toBe(1200);
  });

  it('handles edge case where all stocks are above 200 SMA', async () => {
    globalThis.fetch = createMockFetch({
      above200SMA: 1000,
      totalNSE: 1000,
    }) as typeof fetch;

    const client = new ChartinkClient(DEFAULT_CONFIG);
    const result = await client.fetchBreadthData();

    expect(result.pctAbove200SMA).toBe(100);
    // When decliners = 0, ratio should be capped at 99
    expect(result.ratio4_5).toBe(99);
  });
});

describe('ChartinkClient integration with MBIDataManager mock', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns data compatible with ChartinkBreadthData interface', async () => {
    globalThis.fetch = createMockFetch({}) as typeof fetch;

    const client = new ChartinkClient(DEFAULT_CONFIG);
    const result = await client.fetchBreadthData();

    // Verify all required fields exist and are numbers
    expect(typeof result.pct52WH).toBe('number');
    expect(typeof result.pct52WL).toBe('number');
    expect(typeof result.pctAbove20SMA).toBe('number');
    expect(typeof result.pctAbove50SMA).toBe('number');
    expect(typeof result.pctAbove200SMA).toBe('number');
    expect(typeof result.ratio4_5).toBe('number');
    expect(typeof result.fetchedAt).toBe('string');

    // All percentages should be 0-100
    expect(result.pct52WH).toBeGreaterThanOrEqual(0);
    expect(result.pct52WH).toBeLessThanOrEqual(100);
    expect(result.pctAbove200SMA).toBeGreaterThanOrEqual(0);
    expect(result.pctAbove200SMA).toBeLessThanOrEqual(100);
  });
});
