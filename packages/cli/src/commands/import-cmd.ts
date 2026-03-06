import { parseCSV, validateImport } from '@stark/core/api/csv-import.js';
import { mapSymbols } from '@stark/core/utils/symbol-mapper.js';
import { createDatabase } from '@stark/core/db/index.js';
import { MockProvider } from '@stark/core/api/mock-provider.js';
import { loadConfig } from '@stark/core/config/index.js';

export async function importCommand(args: string[]): Promise<void> {
  const csvPath = args.find((a) => !a.startsWith('-'));
  if (!csvPath) {
    console.error(
      'Usage: stark import <csv-path> [--watchlist=<name>] [--priority=<0-3>]',
    );
    process.exit(1);
  }

  const watchlistName =
    args.find((a) => a.startsWith('--watchlist='))?.split('=')[1] ?? 'default';
  const priority = parseInt(
    args.find((a) => a.startsWith('--priority='))?.split('=')[1] ?? '0',
    10,
  ) as 0 | 1 | 2 | 3;

  console.log(`Importing from ${csvPath}...`);
  const csvResult = parseCSV(csvPath);
  const errors = validateImport(csvResult);
  if (errors.length > 0) {
    for (const err of errors) console.error(`Error: ${err}`);
    process.exit(1);
  }
  console.log(
    `Parsed ${csvResult.stocks.length} symbols (${csvResult.format} format)`,
  );

  // Get instrument master for symbol mapping
  const config = loadConfig();
  let instruments;
  try {
    if (config.angelOne?.apiKey) {
      const { AngelOneProvider } = await import(
        '@stark/core/api/angel-one.js'
      );
      const provider = new AngelOneProvider(config.angelOne.apiKey);
      instruments = await provider.getInstrumentMaster('NSE');
    } else {
      const mock = new MockProvider();
      instruments = await mock.getInstrumentMaster('NSE');
    }
  } catch {
    console.log(
      'Could not fetch instrument master, using mock provider for mapping',
    );
    const mock = new MockProvider();
    instruments = await mock.getInstrumentMaster('NSE');
  }

  const rawSymbols = csvResult.stocks.map((s) => s.rawSymbol);
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
