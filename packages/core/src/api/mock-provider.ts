import type {
  DataProvider,
  Quote,
  SymbolSearchResult,
  InstrumentMaster,
  BrokerPosition,
} from './data-provider.js';
import type { OHLCVBar, OHLCVInterval } from '../models/intervals.js';

// ---------------------------------------------------------------------------
// Fixture data — popular NSE stocks
// ---------------------------------------------------------------------------

const FIXTURE_INSTRUMENTS: InstrumentMaster[] = [
  { token: '2885', symbol: 'RELIANCE', name: 'Reliance Industries Ltd', exchange: 'NSE', instrumentType: 'EQ', lotSize: 1, tickSize: 0.05, sector: 'Energy', industry: 'Oil & Gas' },
  { token: '11536', symbol: 'TCS', name: 'Tata Consultancy Services Ltd', exchange: 'NSE', instrumentType: 'EQ', lotSize: 1, tickSize: 0.05, sector: 'IT', industry: 'IT Services' },
  { token: '1594', symbol: 'INFY', name: 'Infosys Ltd', exchange: 'NSE', instrumentType: 'EQ', lotSize: 1, tickSize: 0.05, sector: 'IT', industry: 'IT Services' },
  { token: '1333', symbol: 'HDFCBANK', name: 'HDFC Bank Ltd', exchange: 'NSE', instrumentType: 'EQ', lotSize: 1, tickSize: 0.05, sector: 'Banking', industry: 'Private Bank' },
  { token: '4963', symbol: 'ICICIBANK', name: 'ICICI Bank Ltd', exchange: 'NSE', instrumentType: 'EQ', lotSize: 1, tickSize: 0.05, sector: 'Banking', industry: 'Private Bank' },
  { token: '10604', symbol: 'BHARTIARTL', name: 'Bharti Airtel Ltd', exchange: 'NSE', instrumentType: 'EQ', lotSize: 1, tickSize: 0.05, sector: 'Telecom', industry: 'Telecom Services' },
  { token: '1660', symbol: 'ITC', name: 'ITC Ltd', exchange: 'NSE', instrumentType: 'EQ', lotSize: 1, tickSize: 0.05, sector: 'FMCG', industry: 'Tobacco & FMCG' },
  { token: '3045', symbol: 'SBIN', name: 'State Bank of India', exchange: 'NSE', instrumentType: 'EQ', lotSize: 1, tickSize: 0.05, sector: 'Banking', industry: 'Public Bank' },
  { token: '1922', symbol: 'KOTAKBANK', name: 'Kotak Mahindra Bank Ltd', exchange: 'NSE', instrumentType: 'EQ', lotSize: 1, tickSize: 0.05, sector: 'Banking', industry: 'Private Bank' },
  { token: '1394', symbol: 'HINDUNILVR', name: 'Hindustan Unilever Ltd', exchange: 'NSE', instrumentType: 'EQ', lotSize: 1, tickSize: 0.05, sector: 'FMCG', industry: 'FMCG' },
];

const BASE_PRICES: Record<string, number> = {
  RELIANCE: 2450, TCS: 3800, INFY: 1650, HDFCBANK: 1700,
  ICICIBANK: 1050, BHARTIARTL: 1550, ITC: 450, SBIN: 780,
  KOTAKBANK: 1850, HINDUNILVR: 2350,
};

// ---------------------------------------------------------------------------
// Synthetic data generators
// ---------------------------------------------------------------------------

function generateOHLCV(
  symbol: string,
  from: string,
  to: string,
): OHLCVBar[] {
  const base = BASE_PRICES[symbol] ?? 1000;
  const bars: OHLCVBar[] = [];
  const start = new Date(from);
  const end = new Date(to);

  let price = base;
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const day = d.getDay();
    if (day === 0 || day === 6) continue; // skip weekends

    const change = (Math.random() - 0.48) * base * 0.03;
    const open = price;
    const close = price + change;
    const high = Math.max(open, close) + Math.random() * base * 0.01;
    const low = Math.min(open, close) - Math.random() * base * 0.01;
    const volume = Math.floor(500000 + Math.random() * 2000000);

    bars.push({
      timestamp: d.toISOString().slice(0, 10),
      open: +open.toFixed(2),
      high: +high.toFixed(2),
      low: +low.toFixed(2),
      close: +close.toFixed(2),
      volume,
    });

    price = close;
  }

  return bars;
}

function generateQuote(symbol: string, token: string): Quote {
  const base = BASE_PRICES[symbol] ?? 1000;
  const change = (Math.random() - 0.5) * base * 0.02;
  const ltp = +(base + change).toFixed(2);

  return {
    symbol,
    token,
    ltp,
    open: +(base + (Math.random() - 0.5) * base * 0.01).toFixed(2),
    high: +(base + Math.random() * base * 0.02).toFixed(2),
    low: +(base - Math.random() * base * 0.02).toFixed(2),
    close: +base.toFixed(2),
    volume: Math.floor(1000000 + Math.random() * 5000000),
    timestamp: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// MockProvider
// ---------------------------------------------------------------------------

export class MockProvider implements DataProvider {
  readonly name = 'mock';
  private authenticated = false;
  private instruments: InstrumentMaster[];

  constructor(fixtures?: InstrumentMaster[]) {
    this.instruments = fixtures ?? FIXTURE_INSTRUMENTS;
  }

  async authenticate(_credentials: Record<string, string>): Promise<void> {
    this.authenticated = true;
  }

  isAuthenticated(): boolean {
    return this.authenticated;
  }

  async dispose(): Promise<void> {
    this.authenticated = false;
  }

  async fetchOHLCV(
    symbol: string,
    _token: string,
    _interval: OHLCVInterval,
    from: string,
    to: string,
  ): Promise<OHLCVBar[]> {
    return generateOHLCV(symbol, from, to);
  }

  async fetchQuote(symbol: string, token: string): Promise<Quote> {
    return generateQuote(symbol, token);
  }

  async fetchQuotes(
    symbols: Array<{ symbol: string; token: string }>,
  ): Promise<Quote[]> {
    return symbols.map((s) => generateQuote(s.symbol, s.token));
  }

  async searchSymbol(query: string): Promise<SymbolSearchResult[]> {
    const q = query.toUpperCase();
    return this.instruments
      .filter(
        (i) =>
          i.symbol.includes(q) ||
          i.name.toUpperCase().includes(q),
      )
      .map((i) => ({
        symbol: i.symbol,
        token: i.token,
        name: i.name,
        exchange: i.exchange,
        instrumentType: i.instrumentType,
      }));
  }

  async getInstrumentMaster(exchange?: string): Promise<InstrumentMaster[]> {
    if (exchange) {
      return this.instruments.filter((i) => i.exchange === exchange);
    }
    return this.instruments;
  }

  async fetchPositions(): Promise<BrokerPosition[]> {
    return [
      { symbol: 'RELIANCE', token: '2885', exchange: 'NSE', quantity: 100, averagePrice: 2450, lastPrice: 2500, pnl: 5000, productType: 'CNC' },
      { symbol: 'TCS', token: '11536', exchange: 'NSE', quantity: 50, averagePrice: 3800, lastPrice: 3850, pnl: 2500, productType: 'CNC' },
    ];
  }
}
