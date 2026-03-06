import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type {
  DataProvider,
  Quote,
  SymbolSearchResult,
  InstrumentMaster,
} from './data-provider.js';
import { DataProviderError } from './data-provider.js';
import type { OHLCVBar, OHLCVInterval } from '../models/intervals.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BASE_URL = 'https://apiconnect.angelone.in';
const INSTRUMENT_MASTER_URL =
  'https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json';

const STARK_DIR = join(homedir(), '.stark');
const SESSION_PATH = join(STARK_DIR, 'session.json');
const INSTRUMENT_CACHE_PATH = join(STARK_DIR, 'instrument-master.json');
const INSTRUMENT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const INTERVAL_MAP: Record<OHLCVInterval, string> = {
  '1m': 'ONE_MINUTE',
  '5m': 'FIVE_MINUTE',
  '15m': 'FIFTEEN_MINUTE',
  '75m': 'SEVENTY_FIVE_MINUTE',
  '1d': 'ONE_DAY',
  '1w': 'ONE_WEEK',
  '1M': 'ONE_MONTH',
};

// ---------------------------------------------------------------------------
// Session types
// ---------------------------------------------------------------------------

interface SessionData {
  jwtToken: string;
  refreshToken: string;
  feedToken: string;
  authenticatedAt: string;
}

interface InstrumentCacheData {
  fetchedAt: string;
  instruments: RawInstrument[];
}

interface RawInstrument {
  token: string;
  symbol: string;
  name: string;
  exch_seg: string;
  instrumenttype: string;
  lotsize: string;
  tick_size: string;
  isin?: string;
  // Additional fields exist but are unused
}

// ---------------------------------------------------------------------------
// AngelOneProvider
// ---------------------------------------------------------------------------

export class AngelOneProvider implements DataProvider {
  readonly name = 'angel_one';
  private apiKey: string;
  private session: SessionData | null = null;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
    mkdirSync(STARK_DIR, { recursive: true });
    this.loadSession();
  }

  // --- Auth ---

  async authenticate(credentials: Record<string, string>): Promise<void> {
    const { clientcode, password, totp } = credentials;
    if (!clientcode || !password || !totp) {
      throw new DataProviderError(
        'auth_expired',
        'Missing credentials: clientcode, password, and totp are required',
      );
    }

    const body = { clientcode, password, totp };

    let res: Response;
    try {
      res = await fetch(
        `${BASE_URL}/rest/auth/angelbroking/user/v1/loginByPassword`,
        {
          method: 'POST',
          headers: this.baseHeaders(),
          body: JSON.stringify(body),
        },
      );
    } catch (err) {
      throw new DataProviderError(
        'network_error',
        `Authentication network error: ${(err as Error).message}`,
        err as Error,
      );
    }

    if (res.status === 429) {
      throw new DataProviderError('rate_limited', 'Rate limited during auth');
    }

    const json = (await res.json()) as {
      status: boolean;
      message: string;
      data?: { jwtToken: string; refreshToken: string; feedToken: string };
    };

    if (!json.status || !json.data) {
      throw new DataProviderError(
        'auth_expired',
        `Authentication failed: ${json.message}`,
      );
    }

    this.session = {
      jwtToken: json.data.jwtToken,
      refreshToken: json.data.refreshToken,
      feedToken: json.data.feedToken,
      authenticatedAt: new Date().toISOString(),
    };

    this.saveSession();
  }

  isAuthenticated(): boolean {
    if (!this.session) return false;
    const authDate = new Date(this.session.authenticatedAt)
      .toISOString()
      .slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);
    return authDate === today;
  }

  async dispose(): Promise<void> {
    this.session = null;
  }

  // --- Market data ---

  async fetchOHLCV(
    _symbol: string,
    token: string,
    interval: OHLCVInterval,
    from: string,
    to: string,
  ): Promise<OHLCVBar[]> {
    this.requireAuth();

    const angelInterval = INTERVAL_MAP[interval];
    if (!angelInterval) {
      throw new DataProviderError(
        'data_unavailable',
        `Unsupported interval: ${interval}`,
      );
    }

    const body = {
      exchange: 'NSE',
      symboltoken: token,
      interval: angelInterval,
      fromdate: `${from} 09:15`,
      todate: `${to} 15:30`,
    };

    const json = await this.post<{
      status: boolean;
      message: string;
      data?: { candles: Array<[string, number, number, number, number, number]> };
    }>('/rest/secure/angelbroking/historical/v1/getCandleData', body);

    if (!json.status || !json.data?.candles) {
      throw new DataProviderError(
        'data_unavailable',
        `OHLCV fetch failed: ${json.message}`,
      );
    }

    return json.data.candles.map(
      ([timestamp, open, high, low, close, volume]) => ({
        timestamp: timestamp.slice(0, 10),
        open,
        high,
        low,
        close,
        volume,
      }),
    );
  }

  async fetchQuote(symbol: string, token: string): Promise<Quote> {
    this.requireAuth();

    const body = {
      mode: 'FULL',
      exchangeTokens: { NSE: [token] },
    };

    const json = await this.post<{
      status: boolean;
      message: string;
      data?: {
        fetched: Array<{
          tradingSymbol: string;
          symbolToken: string;
          ltp: number;
          open: number;
          high: number;
          low: number;
          close: number;
          totalTradedVolume: number;
          exchFeedTime: string;
        }>;
      };
    }>('/rest/secure/angelbroking/market/v1/quote/', body);

    if (!json.status || !json.data?.fetched?.[0]) {
      throw new DataProviderError(
        'data_unavailable',
        `Quote fetch failed for ${symbol}: ${json.message}`,
      );
    }

    const q = json.data.fetched[0];
    return {
      symbol,
      token,
      ltp: q.ltp,
      open: q.open,
      high: q.high,
      low: q.low,
      close: q.close,
      volume: q.totalTradedVolume,
      timestamp: q.exchFeedTime,
    };
  }

  async fetchQuotes(
    symbols: Array<{ symbol: string; token: string }>,
  ): Promise<Quote[]> {
    this.requireAuth();

    const tokens = symbols.map((s) => s.token);
    const body = {
      mode: 'FULL',
      exchangeTokens: { NSE: tokens },
    };

    const json = await this.post<{
      status: boolean;
      message: string;
      data?: {
        fetched: Array<{
          tradingSymbol: string;
          symbolToken: string;
          ltp: number;
          open: number;
          high: number;
          low: number;
          close: number;
          totalTradedVolume: number;
          exchFeedTime: string;
        }>;
      };
    }>('/rest/secure/angelbroking/market/v1/quote/', body);

    if (!json.status || !json.data?.fetched) {
      throw new DataProviderError(
        'data_unavailable',
        `Quotes fetch failed: ${json.message}`,
      );
    }

    const tokenToSymbol = new Map(symbols.map((s) => [s.token, s.symbol]));

    return json.data.fetched.map((q) => ({
      symbol: tokenToSymbol.get(q.symbolToken) ?? q.tradingSymbol,
      token: q.symbolToken,
      ltp: q.ltp,
      open: q.open,
      high: q.high,
      low: q.low,
      close: q.close,
      volume: q.totalTradedVolume,
      timestamp: q.exchFeedTime,
    }));
  }

  // --- Symbol resolution ---

  async searchSymbol(query: string): Promise<SymbolSearchResult[]> {
    const instruments = await this.getInstrumentMaster('NSE');
    const q = query.toUpperCase();
    return instruments
      .filter(
        (i) =>
          i.symbol.toUpperCase().includes(q) ||
          i.name.toUpperCase().includes(q),
      )
      .slice(0, 20)
      .map((i) => ({
        symbol: i.symbol,
        token: i.token,
        name: i.name,
        exchange: i.exchange,
        instrumentType: i.instrumentType,
      }));
  }

  async getInstrumentMaster(exchange?: string): Promise<InstrumentMaster[]> {
    let cache = this.loadInstrumentCache();

    if (!cache || this.isInstrumentCacheStale(cache.fetchedAt)) {
      cache = await this.fetchInstrumentMaster();
    }

    let instruments = cache.instruments.map(this.rawToInstrument);

    if (exchange) {
      instruments = instruments.filter((i) => i.exchange === exchange);
    }

    return instruments;
  }

  // --- Private helpers ---

  private requireAuth(): void {
    if (!this.isAuthenticated()) {
      throw new DataProviderError(
        'auth_expired',
        'Not authenticated. Run `stark auth` first.',
      );
    }
  }

  private baseHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-UserType': 'USER',
      'X-SourceID': 'WEB',
      'X-ClientLocalIP': '127.0.0.1',
      'X-ClientPublicIP': '127.0.0.1',
      'X-MACAddress': '00:00:00:00:00:00',
      'X-PrivateKey': this.apiKey,
    };
  }

  private authHeaders(): Record<string, string> {
    return {
      ...this.baseHeaders(),
      Authorization: `Bearer ${this.session!.jwtToken}`,
    };
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${BASE_URL}${path}`, {
        method: 'POST',
        headers: this.authHeaders(),
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new DataProviderError(
        'network_error',
        `Network error: ${(err as Error).message}`,
        err as Error,
      );
    }

    if (res.status === 401 || res.status === 403) {
      throw new DataProviderError('auth_expired', 'Session expired');
    }
    if (res.status === 429) {
      throw new DataProviderError('rate_limited', 'Rate limited');
    }

    return (await res.json()) as T;
  }

  // --- Session persistence ---

  private loadSession(): void {
    if (!existsSync(SESSION_PATH)) return;
    try {
      this.session = JSON.parse(readFileSync(SESSION_PATH, 'utf-8')) as SessionData;
    } catch {
      this.session = null;
    }
  }

  private saveSession(): void {
    writeFileSync(SESSION_PATH, JSON.stringify(this.session, null, 2), 'utf-8');
  }

  // --- Instrument master cache ---

  private loadInstrumentCache(): InstrumentCacheData | null {
    if (!existsSync(INSTRUMENT_CACHE_PATH)) return null;
    try {
      return JSON.parse(
        readFileSync(INSTRUMENT_CACHE_PATH, 'utf-8'),
      ) as InstrumentCacheData;
    } catch {
      return null;
    }
  }

  private isInstrumentCacheStale(fetchedAt: string): boolean {
    const age = Date.now() - new Date(fetchedAt).getTime();
    return age > INSTRUMENT_MAX_AGE_MS;
  }

  private async fetchInstrumentMaster(): Promise<InstrumentCacheData> {
    let res: Response;
    try {
      res = await fetch(INSTRUMENT_MASTER_URL);
    } catch (err) {
      throw new DataProviderError(
        'network_error',
        `Instrument master fetch failed: ${(err as Error).message}`,
        err as Error,
      );
    }

    if (!res.ok) {
      throw new DataProviderError(
        'data_unavailable',
        `Instrument master HTTP ${res.status}`,
      );
    }

    const instruments = (await res.json()) as RawInstrument[];
    const cache: InstrumentCacheData = {
      fetchedAt: new Date().toISOString(),
      instruments,
    };

    writeFileSync(INSTRUMENT_CACHE_PATH, JSON.stringify(cache), 'utf-8');
    return cache;
  }

  private rawToInstrument(raw: RawInstrument): InstrumentMaster {
    return {
      token: raw.token,
      symbol: raw.symbol,
      name: raw.name,
      exchange: raw.exch_seg,
      instrumentType: raw.instrumenttype,
      lotSize: parseInt(raw.lotsize, 10) || 1,
      tickSize: parseFloat(raw.tick_size) || 0.05,
      isin: raw.isin,
    };
  }
}
