import type { OHLCVBar, OHLCVInterval } from '../models/intervals.js';

// ---------------------------------------------------------------------------
// DataProviderError — discriminated union for typed error handling
// ---------------------------------------------------------------------------

export type DataProviderErrorKind =
  | 'auth_expired'
  | 'rate_limited'
  | 'data_unavailable'
  | 'network_error';

export class DataProviderError extends Error {
  constructor(
    public readonly kind: DataProviderErrorKind,
    message: string,
    public readonly cause?: Error,
  ) {
    super(message);
    this.name = 'DataProviderError';
  }
}

// ---------------------------------------------------------------------------
// Data shapes
// ---------------------------------------------------------------------------

export interface Quote {
  symbol: string;
  token: string;
  ltp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timestamp: string;
}

export interface BrokerPosition {
  symbol: string;
  token: string;
  exchange: string;
  quantity: number;
  averagePrice: number;
  lastPrice: number;
  pnl: number;
  productType: string; // 'CNC' for delivery, 'INTRADAY' for intraday
}

export interface SymbolSearchResult {
  symbol: string;
  token: string;
  name: string;
  exchange: string;
  instrumentType: string;
}

export interface InstrumentMaster {
  token: string;
  symbol: string;
  name: string;
  exchange: string;
  instrumentType: string;
  lotSize: number;
  tickSize: number;
  isin?: string;
  listingDate?: string;
  sector?: string;
  industry?: string;
}

// ---------------------------------------------------------------------------
// DataProvider interface — seam 8 for future providers (OpenAlgo etc.)
// ---------------------------------------------------------------------------

export interface DataProvider {
  readonly name: string;

  // Auth
  authenticate(credentials: Record<string, string>): Promise<void>;
  isAuthenticated(): boolean;
  dispose(): Promise<void>;

  // Market data
  fetchOHLCV(
    symbol: string,
    token: string,
    interval: OHLCVInterval,
    from: string,
    to: string,
  ): Promise<OHLCVBar[]>;
  fetchQuote(symbol: string, token: string): Promise<Quote>;
  fetchQuotes(
    symbols: Array<{ symbol: string; token: string }>,
  ): Promise<Quote[]>;

  // Symbol resolution
  searchSymbol(query: string): Promise<SymbolSearchResult[]>;
  getInstrumentMaster(exchange?: string): Promise<InstrumentMaster[]>;

  // Portfolio
  fetchPositions(): Promise<BrokerPosition[]>;
}
