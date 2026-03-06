import { describe, it, expect } from 'vitest';
import {
  normalizeSymbol,
  buildSymbolIndex,
  mapSymbol,
  mapSymbols,
} from '../src/utils/symbol-mapper.js';
import type { InstrumentMaster } from '../src/api/data-provider.js';

const FIXTURES: InstrumentMaster[] = [
  { token: '2885', symbol: 'RELIANCE', name: 'Reliance Industries Ltd', exchange: 'NSE', instrumentType: 'EQ', lotSize: 1, tickSize: 0.05 },
  { token: '11536', symbol: 'TCS', name: 'Tata Consultancy Services Ltd', exchange: 'NSE', instrumentType: 'EQ', lotSize: 1, tickSize: 0.05 },
  { token: '1594', symbol: 'INFY', name: 'Infosys Ltd', exchange: 'NSE', instrumentType: 'EQ', lotSize: 1, tickSize: 0.05 },
  { token: '1333', symbol: 'HDFCBANK', name: 'HDFC Bank Ltd', exchange: 'NSE', instrumentType: 'EQ', lotSize: 1, tickSize: 0.05 },
  { token: '9999', symbol: 'RELIANCEFUT', name: 'Reliance Futures', exchange: 'NSE', instrumentType: 'FUT', lotSize: 250, tickSize: 0.05 },
];

describe('normalizeSymbol', () => {
  it('strips exchange prefix', () => {
    expect(normalizeSymbol('NSE:RELIANCE')).toBe('RELIANCE');
    expect(normalizeSymbol('BSE:TCS')).toBe('TCS');
  });

  it('uppercases and trims', () => {
    expect(normalizeSymbol('  reliance  ')).toBe('RELIANCE');
  });

  it('handles plain symbols', () => {
    expect(normalizeSymbol('INFY')).toBe('INFY');
  });
});

describe('buildSymbolIndex', () => {
  it('indexes only NSE EQ instruments', () => {
    const index = buildSymbolIndex(FIXTURES);
    expect(index.size).toBe(4); // excludes RELIANCEFUT (FUT)
    expect(index.has('RELIANCE')).toBe(true);
    expect(index.has('RELIANCEFUT')).toBe(false);
  });
});

describe('mapSymbol', () => {
  const index = buildSymbolIndex(FIXTURES);

  it('finds exact match', () => {
    const result = mapSymbol('NSE:RELIANCE', index);
    expect(result.matched).toBe(true);
    expect(result.matchType).toBe('exact');
    expect(result.token).toBe('2885');
    expect(result.symbol).toBe('RELIANCE');
  });

  it('fuzzy matches within distance 2', () => {
    // "RELIACE" is distance 1 from "RELIANCE"
    const result = mapSymbol('RELIACE', index);
    expect(result.matched).toBe(true);
    expect(result.matchType).toBe('fuzzy');
    expect(result.symbol).toBe('RELIANCE');
  });

  it('returns no match for distant symbols', () => {
    const result = mapSymbol('XYZABC', index);
    expect(result.matched).toBe(false);
    expect(result.matchType).toBe('none');
  });
});

describe('mapSymbols', () => {
  it('maps batch of symbols', () => {
    const { mapped, unmapped } = mapSymbols(
      ['NSE:RELIANCE', 'TCS', 'UNKNOWN_STOCK'],
      FIXTURES,
    );
    expect(mapped).toHaveLength(3);
    expect(mapped[0].matched).toBe(true);
    expect(mapped[1].matched).toBe(true);
    expect(mapped[2].matched).toBe(false);
    expect(unmapped).toEqual(['UNKNOWN_STOCK']);
  });
});
