import type { DataProvider, InstrumentMaster } from '../api/data-provider.js';

export interface ConstituentInfo {
  symbol: string;
  token: string;
}

export interface ConstituentList {
  symbols: ConstituentInfo[];
  source: 'nse_csv' | 'hardcoded';
  fetchedAt: string;
}

/**
 * Hardcoded NIFTY 50 constituents.
 * Angel One instrument master has NO index membership data,
 * so this hardcoded list is the PRIMARY source.
 * Needs manual update ~2-4 times/year when NIFTY 50 constituents change.
 * Token '0' means "needs resolution via instrument master".
 */
const NIFTY_50_SYMBOLS: ConstituentInfo[] = [
  { symbol: 'ADANIENT', token: '0' },
  { symbol: 'ADANIPORTS', token: '0' },
  { symbol: 'APOLLOHOSP', token: '0' },
  { symbol: 'ASIANPAINT', token: '0' },
  { symbol: 'AXISBANK', token: '0' },
  { symbol: 'BAJAJ-AUTO', token: '0' },
  { symbol: 'BAJFINANCE', token: '0' },
  { symbol: 'BAJAJFINSV', token: '0' },
  { symbol: 'BEL', token: '0' },
  { symbol: 'BPCL', token: '0' },
  { symbol: 'BHARTIARTL', token: '0' },
  { symbol: 'BRITANNIA', token: '0' },
  { symbol: 'CIPLA', token: '0' },
  { symbol: 'COALINDIA', token: '0' },
  { symbol: 'DRREDDY', token: '0' },
  { symbol: 'EICHERMOT', token: '0' },
  { symbol: 'GRASIM', token: '0' },
  { symbol: 'HCLTECH', token: '0' },
  { symbol: 'HDFCBANK', token: '0' },
  { symbol: 'HDFCLIFE', token: '0' },
  { symbol: 'HEROMOTOCO', token: '0' },
  { symbol: 'HINDALCO', token: '0' },
  { symbol: 'HINDUNILVR', token: '0' },
  { symbol: 'ICICIBANK', token: '0' },
  { symbol: 'ITC', token: '0' },
  { symbol: 'INDUSINDBK', token: '0' },
  { symbol: 'INFY', token: '0' },
  { symbol: 'JSWSTEEL', token: '0' },
  { symbol: 'KOTAKBANK', token: '0' },
  { symbol: 'LT', token: '0' },
  { symbol: 'M&M', token: '0' },
  { symbol: 'MARUTI', token: '0' },
  { symbol: 'NESTLEIND', token: '0' },
  { symbol: 'NTPC', token: '0' },
  { symbol: 'ONGC', token: '0' },
  { symbol: 'POWERGRID', token: '0' },
  { symbol: 'RELIANCE', token: '0' },
  { symbol: 'SBILIFE', token: '0' },
  { symbol: 'SHRIRAMFIN', token: '0' },
  { symbol: 'SBIN', token: '0' },
  { symbol: 'SUNPHARMA', token: '0' },
  { symbol: 'TCS', token: '0' },
  { symbol: 'TATACONSUM', token: '0' },
  { symbol: 'TATAMOTORS', token: '0' },
  { symbol: 'TATASTEEL', token: '0' },
  { symbol: 'TECHM', token: '0' },
  { symbol: 'TITAN', token: '0' },
  { symbol: 'TRENT', token: '0' },
  { symbol: 'ULTRACEMCO', token: '0' },
  { symbol: 'WIPRO', token: '0' },
];

/**
 * Returns the hardcoded NIFTY 50 constituent list.
 * This is the PRIMARY source since Angel One has no index membership data.
 */
export function getNifty50Constituents(): ConstituentInfo[] {
  return NIFTY_50_SYMBOLS.map((c) => ({ ...c }));
}

/**
 * Resolve Angel One tokens for symbols via instrument master.
 * Matches by symbol name against the NSE instrument master.
 * Symbols that cannot be resolved keep token '0'.
 */
export async function resolveTokens(
  provider: DataProvider,
  symbols: ConstituentInfo[],
): Promise<ConstituentInfo[]> {
  const instruments = await provider.getInstrumentMaster('NSE');
  const tokenMap = new Map<string, string>();

  for (const inst of instruments) {
    tokenMap.set(inst.symbol, inst.token);
  }

  return symbols.map((s) => ({
    symbol: s.symbol,
    token: tokenMap.get(s.symbol) ?? s.token,
  }));
}
