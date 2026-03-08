import { parseCSV, validateImport } from '@stark/core/api/csv-import.js';
import { mapSymbols } from '@stark/core/utils/symbol-mapper.js';
import { createDatabase } from '@stark/core/db/index.js';
import { scrapeWatchlistUrl } from '@stark/core/api/watchlist-scraper.js';
import { createCommandContext } from '../utils/command-context.js';

export async function importCommand(args: string[]): Promise<void> {
  const firstArg = args.find((a) => !a.startsWith('-'));

  if (args.includes('--broker')) {
    console.log('Broker import: Coming soon.');
    console.log('This will fetch your broker watchlists directly from Angel One.');
    return;
  }

  if (!firstArg) {
    console.error(
      'Usage: stark import <csv-path|symbols|url> [--watchlist=<name>] [--priority=<0-3>]',
    );
    console.error('  stark import file.csv           — import from CSV');
    console.error('  stark import RELIANCE TCS INFY   — import symbols directly');
    console.error('  stark import https://...         — scrape TradingView watchlist URL');
    console.error('  stark import --broker            — import from broker (coming soon)');
    process.exit(1);
  }

  const watchlistName =
    args.find((a) => a.startsWith('--watchlist='))?.split('=')[1] ?? 'default';
  const priority = parseInt(
    args.find((a) => a.startsWith('--priority='))?.split('=')[1] ?? '0',
    10,
  ) as 0 | 1 | 2 | 3;

  // Detect input mode
  const isUrl = firstArg.startsWith('http://') || firstArg.startsWith('https://');
  const isSymbolList = !isUrl && !firstArg.includes('.') && !firstArg.includes('/');

  let rawSymbols: string[];

  if (isUrl) {
    // URL scrape mode
    console.log(`Scraping watchlist from ${firstArg}...`);
    let llmService = null;
    try {
      const ctx = await createCommandContext();
      llmService = ctx.llmService;
    } catch { /* proceed without LLM */ }

    const result = await scrapeWatchlistUrl(firstArg, llmService);
    if (result.symbols.length === 0) {
      console.error('No symbols found at the provided URL.');
      process.exit(1);
    }
    rawSymbols = result.symbols;
    console.log(`Found ${rawSymbols.length} symbols (${result.format} format)`);
  } else if (isSymbolList) {
    // Symbol list mode: all non-flag args are symbols
    rawSymbols = args
      .filter((a) => !a.startsWith('-'))
      .map((s) => s.toUpperCase());
    console.log(`Importing ${rawSymbols.length} symbols: ${rawSymbols.join(', ')}`);
  } else {
    // CSV file mode (existing behavior)
    console.log(`Importing from ${firstArg}...`);
    const csvResult = parseCSV(firstArg);
    const errors = validateImport(csvResult);
    if (errors.length > 0) {
      for (const err of errors) console.error(`Error: ${err}`);
      process.exit(1);
    }
    rawSymbols = csvResult.stocks.map((s) => s.rawSymbol);
    console.log(
      `Parsed ${csvResult.stocks.length} symbols (${csvResult.format} format)`,
    );
  }

  // Get instrument master for symbol mapping
  let instruments;
  try {
    const ctx = await createCommandContext();
    instruments = await ctx.provider.getInstrumentMaster('NSE');
  } catch {
    console.log('Could not authenticate, using mock provider for mapping');
    const { MockProvider } = await import('@stark/core/api/mock-provider.js');
    const mock = new MockProvider();
    instruments = await mock.getInstrumentMaster('NSE');
  }

  const { mapped, unmapped } = mapSymbols(rawSymbols, instruments);

  if (unmapped.length > 0) {
    console.log(`\nWarning: ${unmapped.length} symbols could not be mapped:`);
    for (const s of unmapped) console.log(`  - ${s}`);
  }

  const { queries } = createDatabase();
  const watchlistId = queries.insertWatchlist(watchlistName);

  let importCount = 0;
  for (const m of mapped) {
    if (!m.matched) continue;
    queries.insertWatchlistStock({
      watchlistId,
      symbol: m.symbol,
      token: m.token,
      name: m.name,
      priority,
    });
    importCount++;
  }

  console.log(
    `\nImported ${importCount} stocks to watchlist "${watchlistName}" (priority ${priority})`,
  );

  const fuzzyMatches = mapped.filter((m) => m.matchType === 'fuzzy');
  if (fuzzyMatches.length > 0) {
    console.log('\nFuzzy matched symbols (verify these):');
    for (const m of fuzzyMatches) {
      console.log(`  ${m.tradingViewSymbol} → ${m.symbol} (${m.name})`);
    }
  }
}
