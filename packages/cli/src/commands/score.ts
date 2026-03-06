import { ScoringEngine } from '@stark/core/scoring/engine.js';
import { createDatabase } from '@stark/core/db/index.js';
import { MockProvider } from '@stark/core/api/mock-provider.js';
import { loadConfig } from '@stark/core/config/index.js';

export async function scoreCommand(args: string[]): Promise<void> {
  const symbolArg = args.find((a) => a.startsWith('--symbol='))?.split('=')[1];
  const scoreAll = args.includes('--all');

  if (!symbolArg && !scoreAll) {
    console.error('Usage: stark score --symbol=RELIANCE | --all');
    process.exit(1);
  }

  const config = loadConfig();
  const { db, queries } = createDatabase();

  // Use mock provider for now (Angel One requires auth)
  let provider;
  try {
    if (config.angelOne?.apiKey) {
      const { AngelOneProvider } = await import(
        '@stark/core/api/angel-one.js'
      );
      const p = new AngelOneProvider(config.angelOne.apiKey);
      if (p.isAuthenticated()) {
        provider = p;
      }
    }
  } catch { /* fall through to mock */ }

  if (!provider) {
    provider = new MockProvider();
    console.log('Using mock data (no authenticated session)\n');
  }

  const engine = new ScoringEngine(provider, db);

  if (symbolArg) {
    // Score single symbol
    const token = '0'; // Will be resolved from watchlist/instrument master
    console.log(`Scoring ${symbolArg}...\n`);

    const result = await engine.scoreSymbol(symbolArg, token, {
      sessionId: 'cli-single',
      startedAt: Date.now(),
      symbols: [symbolArg],
      apiCalls: {},
      cacheHits: 0,
      cacheMisses: 0,
      llmCalls: 0,
      errors: [],
    });

    printResult(result);
  } else {
    // Score all watchlist stocks
    const watchlistStocks = queries.getWatchlistStocks(1, 0);
    if (watchlistStocks.length === 0) {
      console.log('No stocks in watchlist. Run `stark import` first.');
      process.exit(0);
    }

    console.log(`Scoring ${watchlistStocks.length} stocks...\n`);

    const symbols = watchlistStocks.map((s) => ({
      symbol: s.symbol,
      token: s.token,
      name: s.name,
    }));

    const { results, context } = await engine.scoreBatch(symbols);

    for (const result of results) {
      printResult(result);
      console.log('');
    }

    // Print context summary
    console.log('--- Batch Summary ---');
    console.log(`Symbols scored: ${results.length}`);
    console.log(`API calls: ${JSON.stringify(context.apiCalls)}`);
    console.log(`Cache: ${context.cacheHits} hits, ${context.cacheMisses} misses`);
    if (context.errors.length > 0) {
      console.log(`Errors: ${context.errors.length}`);
      for (const e of context.errors) {
        console.log(`  ${e.symbol}/${e.factor}: ${e.error}`);
      }
    }
    console.log(
      `Duration: ${((context.completedAt ?? Date.now()) - context.startedAt) / 1000}s`,
    );
  }
}

function printResult(result: {
  symbol: string;
  factors: Array<{
    factorName: string;
    score: number;
    maxScore: number;
    reasoning: string;
  }>;
  algorithmicScore: number;
  maxPossibleScore: number;
}): void {
  console.log(`=== ${result.symbol} ===`);
  console.log(
    `Algorithmic Score: ${result.algorithmicScore} / ${result.maxPossibleScore} (PARTIAL)`,
  );
  console.log('');

  for (const f of result.factors) {
    const mark = f.score > 0 ? '✓' : '✗';
    const scoreStr =
      f.maxScore === 1
        ? f.score === 1
          ? '1'
          : '0'
        : f.score.toFixed(1);
    console.log(`  ${mark} ${f.factorName}: ${scoreStr}/${f.maxScore}`);
    console.log(`    ${f.reasoning}`);
  }
}
