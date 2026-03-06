import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ImportedStock {
  rawSymbol: string;
  symbol: string;
  description?: string;
}

export interface CSVImportResult {
  stocks: ImportedStock[];
  format: 'tradingview' | 'plain';
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Symbol normalization
// ---------------------------------------------------------------------------

function normalizeSymbol(raw: string): string {
  // Strip exchange prefix (NSE:, BSE:)
  const stripped = raw.includes(':') ? raw.split(':').pop()! : raw;
  return stripped.trim().toUpperCase();
}

// ---------------------------------------------------------------------------
// CSV parsing
// ---------------------------------------------------------------------------

export function parseCSV(filePath: string): CSVImportResult {
  const absPath = resolve(filePath);
  const content = readFileSync(absPath, 'utf-8');
  const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const warnings: string[] = [];

  if (lines.length === 0) {
    return { stocks: [], format: 'plain', warnings: ['Empty file'] };
  }

  // Detect format: TradingView CSV has a header with "Symbol"
  const firstLine = lines[0].trim();
  const isTradingView =
    /^symbol/i.test(firstLine) ||
    firstLine.includes('\t') && /symbol/i.test(firstLine);

  const delimiter = firstLine.includes('\t') ? '\t' : ',';
  const stocks: ImportedStock[] = [];
  const seen = new Set<string>();

  const startIdx = isTradingView ? 1 : 0; // skip header for TV format

  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    let rawSymbol: string;
    let description: string | undefined;

    if (isTradingView) {
      const parts = line.split(delimiter);
      rawSymbol = parts[0]?.trim() ?? '';
      description = parts[1]?.trim() || undefined;
    } else {
      // Plain format: one symbol per line (may have exchange prefix)
      rawSymbol = line.split(delimiter)[0]?.trim() ?? '';
    }

    if (!rawSymbol) {
      warnings.push(`Line ${i + 1}: empty symbol, skipped`);
      continue;
    }

    const symbol = normalizeSymbol(rawSymbol);

    if (!symbol || !/^[A-Z0-9&_-]+$/.test(symbol)) {
      warnings.push(`Line ${i + 1}: invalid symbol "${rawSymbol}", skipped`);
      continue;
    }

    if (seen.has(symbol)) {
      warnings.push(`Line ${i + 1}: duplicate "${symbol}", skipped`);
      continue;
    }

    seen.add(symbol);
    stocks.push({ rawSymbol, symbol, description });
  }

  return {
    stocks,
    format: isTradingView ? 'tradingview' : 'plain',
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export function validateImport(result: CSVImportResult): string[] {
  const errors: string[] = [];
  if (result.stocks.length === 0) {
    errors.push('No valid symbols found in file');
  }
  return errors;
}
