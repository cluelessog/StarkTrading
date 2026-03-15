import { createCommandContext } from '../utils/command-context.js';
import type { ScoreResult } from '@stark/core/scoring/engine.js';

export async function scoreCommand(args: string[]): Promise<void> {
  // Support positional arg: stark score RELIANCE
  const symbolArg =
    args.find((a) => a.startsWith('--symbol='))?.split('=')[1] ??
    args.find((a) => !a.startsWith('-') && /^[A-Z]/.test(a));
  const scoreAll = args.includes('--all');

  if (!symbolArg && !scoreAll) {
    console.error('Usage: stark score <SYMBOL> | --all');
    process.exit(1);
  }

  const { queries, engine, provider } = await createCommandContext();

  if (symbolArg) {
    const symbol = symbolArg.toUpperCase();

    // Resolve token from watchlist first
    const allStocks = queries.getWatchlistStocks(1);
    const watchlistMatch = allStocks.find((s) => s.symbol === symbol);

    let token: string;
    if (watchlistMatch) {
      token = watchlistMatch.token;
    } else {
      // Fall back to instrument master search
      const results = await provider.searchSymbol(symbol);
      const exact = results.find((r) => r.symbol === symbol);
      if (!exact) {
        console.error(`Symbol '${symbol}' not found in watchlist or instrument master.`);
        process.exit(1);
      }
      token = exact.token;
    }

    console.log(`Scoring ${symbol} (token: ${token})...\n`);

    const result = await engine.scoreSymbol(symbol, token, {
      sessionId: 'cli-single',
      startedAt: Date.now(),
      symbols: [symbol],
      apiCalls: {},
      cacheHits: 0,
      cacheMisses: 0,
      llmCalls: 0,
      errors: [],
      degradedFactors: [],
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

function printResult(result: ScoreResult): void {
  console.log(`=== ${result.symbol} ===`);
  console.log(
    `Score: ${result.totalScore} / ${result.maxPossibleScore} (${result.status})`,
  );
  if (result.status === 'COMPLETE') {
    console.log(`  Algorithmic: ${result.algorithmicScore}  Discretionary: ${result.discretionaryScore}`);
  }
  console.log('');

  for (const f of result.factors) {
    const mark = f.score > 0 ? '✓' : '✗';
    const degradedMark = f.degraded ? ' [degraded]' : '';
    const scoreStr =
      f.maxScore === 1
        ? f.score === 1
          ? '1'
          : f.score === 0
            ? '0'
            : f.score.toFixed(1)
        : f.score.toFixed(1);
    console.log(`  ${mark} ${f.factorName}: ${scoreStr}/${f.maxScore}${degradedMark}`);
    console.log(`    ${f.reasoning}`);
  }

  if (result.degradedFactors.length > 0) {
    console.log(
      `\nNote: ${result.degradedFactors.length} factor(s) scored with reduced accuracy due to LLM API issues: ${result.degradedFactors.join(', ')}`,
    );
  }
}
