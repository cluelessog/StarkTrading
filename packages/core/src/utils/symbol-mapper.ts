import type { InstrumentMaster } from '../api/data-provider.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SymbolMapping {
  tradingViewSymbol: string;
  symbol: string;
  token: string;
  name: string;
  exchange: string;
  matched: boolean;
  matchType: 'exact' | 'fuzzy' | 'none';
}

// ---------------------------------------------------------------------------
// Symbol normalization
// ---------------------------------------------------------------------------

export function normalizeSymbol(raw: string): string {
  const stripped = raw.includes(':') ? raw.split(':').pop()! : raw;
  return stripped.trim().toUpperCase();
}

// ---------------------------------------------------------------------------
// Levenshtein distance (simple DP, no external deps)
// ---------------------------------------------------------------------------

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    Array(n + 1).fill(0) as number[],
  );
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost,
      );
    }
  }
  return dp[m][n];
}

// ---------------------------------------------------------------------------
// Index builder + mapping
// ---------------------------------------------------------------------------

export function buildSymbolIndex(
  instruments: InstrumentMaster[],
): Map<string, InstrumentMaster> {
  const index = new Map<string, InstrumentMaster>();
  for (const inst of instruments) {
    // NSE equity only
    if (inst.exchange === 'NSE' && inst.instrumentType === 'EQ') {
      index.set(inst.symbol.toUpperCase(), inst);
    }
  }
  return index;
}

export function mapSymbol(
  raw: string,
  index: Map<string, InstrumentMaster>,
): SymbolMapping {
  const symbol = normalizeSymbol(raw);
  const empty: SymbolMapping = {
    tradingViewSymbol: raw,
    symbol,
    token: '',
    name: '',
    exchange: 'NSE',
    matched: false,
    matchType: 'none',
  };

  // Exact match
  const exact = index.get(symbol);
  if (exact) {
    return {
      tradingViewSymbol: raw,
      symbol: exact.symbol,
      token: exact.token,
      name: exact.name,
      exchange: exact.exchange,
      matched: true,
      matchType: 'exact',
    };
  }

  // Fuzzy match — Levenshtein distance ≤ 2
  let bestMatch: InstrumentMaster | undefined;
  let bestDist = 3; // threshold + 1
  for (const [key, inst] of index) {
    const dist = levenshtein(symbol, key);
    if (dist < bestDist) {
      bestDist = dist;
      bestMatch = inst;
    }
  }

  if (bestMatch && bestDist <= 2) {
    return {
      tradingViewSymbol: raw,
      symbol: bestMatch.symbol,
      token: bestMatch.token,
      name: bestMatch.name,
      exchange: bestMatch.exchange,
      matched: true,
      matchType: 'fuzzy',
    };
  }

  return empty;
}

export function mapSymbols(
  raws: string[],
  instruments: InstrumentMaster[],
): { mapped: SymbolMapping[]; unmapped: string[] } {
  const index = buildSymbolIndex(instruments);
  const mapped: SymbolMapping[] = [];
  const unmapped: string[] = [];

  for (const raw of raws) {
    const result = mapSymbol(raw, index);
    mapped.push(result);
    if (!result.matched) {
      unmapped.push(raw);
    }
  }

  return { mapped, unmapped };
}
