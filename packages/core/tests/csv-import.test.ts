import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseCSV, validateImport } from '../src/api/csv-import.js';

const TMP_DIR = join(tmpdir(), 'stark-csv-test');

beforeEach(() => {
  mkdirSync(TMP_DIR, { recursive: true });
});

afterEach(() => {
  try {
    const { readdirSync } = require('node:fs');
    for (const f of readdirSync(TMP_DIR)) unlinkSync(join(TMP_DIR, f));
  } catch { /* ignore */ }
});

function writeTmp(name: string, content: string): string {
  const p = join(TMP_DIR, name);
  writeFileSync(p, content, 'utf-8');
  return p;
}

describe('parseCSV', () => {
  it('parses TradingView CSV format', () => {
    const path = writeTmp('tv.csv', [
      'Symbol,Description',
      'NSE:RELIANCE,Reliance Industries Ltd',
      'NSE:TCS,Tata Consultancy Services Ltd',
      'NSE:INFY,Infosys Ltd',
    ].join('\n'));

    const result = parseCSV(path);
    expect(result.format).toBe('tradingview');
    expect(result.stocks).toHaveLength(3);
    expect(result.stocks[0].symbol).toBe('RELIANCE');
    expect(result.stocks[0].description).toBe('Reliance Industries Ltd');
    expect(result.stocks[1].symbol).toBe('TCS');
  });

  it('parses plain symbol list', () => {
    const path = writeTmp('plain.txt', 'RELIANCE\nTCS\nINFY\n');
    const result = parseCSV(path);
    expect(result.format).toBe('plain');
    expect(result.stocks).toHaveLength(3);
    expect(result.stocks[0].symbol).toBe('RELIANCE');
  });

  it('handles exchange prefixes in plain format', () => {
    const path = writeTmp('prefixed.txt', 'NSE:RELIANCE\nBSE:TCS\n');
    const result = parseCSV(path);
    expect(result.stocks[0].symbol).toBe('RELIANCE');
    expect(result.stocks[1].symbol).toBe('TCS');
  });

  it('deduplicates symbols', () => {
    const path = writeTmp('dups.txt', 'RELIANCE\nTCS\nRELIANCE\n');
    const result = parseCSV(path);
    expect(result.stocks).toHaveLength(2);
    expect(result.warnings.some((w) => w.includes('duplicate'))).toBe(true);
  });

  it('skips empty lines', () => {
    const path = writeTmp('empty.txt', 'RELIANCE\n\n\nTCS\n');
    const result = parseCSV(path);
    expect(result.stocks).toHaveLength(2);
  });

  it('warns about invalid symbols', () => {
    const path = writeTmp('bad.txt', 'RELIANCE\n!!!INVALID\nTCS\n');
    const result = parseCSV(path);
    expect(result.stocks).toHaveLength(2);
    expect(result.warnings.some((w) => w.includes('invalid'))).toBe(true);
  });

  it('handles tab-separated TradingView format', () => {
    const path = writeTmp('tabs.csv', [
      'Symbol\tDescription',
      'NSE:RELIANCE\tReliance Industries',
      'NSE:TCS\tTCS Ltd',
    ].join('\n'));

    const result = parseCSV(path);
    expect(result.format).toBe('tradingview');
    expect(result.stocks).toHaveLength(2);
  });
});

describe('validateImport', () => {
  it('returns error for empty result', () => {
    const errors = validateImport({ stocks: [], format: 'plain', warnings: [] });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('No valid symbols');
  });

  it('returns no errors for valid result', () => {
    const errors = validateImport({
      stocks: [{ rawSymbol: 'RELIANCE', symbol: 'RELIANCE' }],
      format: 'plain',
      warnings: [],
    });
    expect(errors).toHaveLength(0);
  });
});
