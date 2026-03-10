import type { LLMService } from '../llm/index.js';

export interface ScrapeResult {
  symbols: string[];
  source: string;
  format: 'tradingview' | 'unknown';
}

/**
 * Scrape stock symbols from a TradingView watchlist URL.
 * Falls back to LLM-based extraction if HTML parsing fails.
 */
export async function scrapeWatchlistUrl(
  url: string,
  llmService?: LLMService | null,
): Promise<ScrapeResult> {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; StarkTrading/1.0)',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const html = await response.text();
    const symbols = extractSymbolsFromHTML(html);

    if (symbols.length > 0) {
      return { symbols, source: url, format: 'tradingview' };
    }

    // HTML parsing found nothing — try LLM fallback
    if (llmService) {
      return await llmFallback(url, llmService);
    }

    return { symbols: [], source: url, format: 'unknown' };
  } catch (err) {
    // Fetch failed — try LLM fallback
    if (llmService) {
      return await llmFallback(url, llmService);
    }

    throw new Error(`Failed to scrape watchlist URL: ${(err as Error).message}`);
  }
}

function extractSymbolsFromHTML(html: string): string[] {
  const symbols = new Set<string>();

  // Pattern 1: NSE: prefixed symbols (e.g., NSE:RELIANCE)
  const nsePattern = /NSE:([A-Z][A-Z0-9_]+)/g;
  let match;
  while ((match = nsePattern.exec(html)) !== null) {
    symbols.add(match[1]);
  }

  // Pattern 2: data-symbol attribute (e.g., data-symbol="NSE:RELIANCE")
  const dataSymbolPattern = /data-symbol="(?:NSE:)?([A-Z][A-Z0-9_]+)"/g;
  while ((match = dataSymbolPattern.exec(html)) !== null) {
    symbols.add(match[1]);
  }

  // Pattern 3: JSON in script blocks with symbol arrays
  const scriptPattern = /"symbol"\s*:\s*"(?:NSE:)?([A-Z][A-Z0-9_]+)"/g;
  while ((match = scriptPattern.exec(html)) !== null) {
    symbols.add(match[1]);
  }

  return Array.from(symbols);
}

async function llmFallback(
  url: string,
  llmService: LLMService,
): Promise<ScrapeResult> {
  try {
    const result = await llmService.research(
      `List all NSE India stock symbols from this TradingView watchlist URL: ${url}. Return only the stock symbols separated by commas, no explanations.`,
    );

    const symbolPattern = /[A-Z][A-Z0-9_]{1,20}/g;
    const symbols = (result.answer.match(symbolPattern) ?? []).filter(
      (s) => s.length >= 2 && s.length <= 20,
    );

    return { symbols, source: `llm:${url}`, format: 'unknown' };
  } catch {
    return { symbols: [], source: url, format: 'unknown' };
  }
}
