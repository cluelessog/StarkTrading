import { classifyRegimeFull, getFocusParams } from '@stark/core/mbi/regime-classifier.js';
import { generateFocusList } from '@stark/core/mbi/focus-list.js';
import { logger } from '@stark/core/log/index.js';
import { formatBreadthSummary } from '@stark/core/mbi/format.js';
import type { MBIRegime } from '@stark/core/models/market.js';
import { createCommandContext } from '../utils/command-context.js';

export async function eveningCommand(_args: string[]): Promise<void> {
  const startTime = Date.now();
  const { config, db, queries, engine, mbiManager } = await createCommandContext();
  const registry = engine.getRegistry();

  console.log('=== Evening Workflow ===\n');

  // 1. Fetch MBI regime (before scoring)
  let regime: MBIRegime = 'CAUTIOUS';
  try {
    const mbiResult = await mbiManager.getLatestRegime();
    const regimeResult = classifyRegimeFull(mbiResult.mbi);
    regime = regimeResult.regime;

    console.log(`Market Regime: ${regime} (EM: ${mbiResult.mbi.em ?? 'N/A'}, source: ${mbiResult.source})`);
    console.log(formatBreadthSummary(mbiResult.mbi));
    console.log('');

    // Store market context in DB
    const today = new Date().toISOString().slice(0, 10);
    queries.upsertMarketContext({
      date: today,
      niftyClose: 0,
      nifty50DMA: 0,
      nifty200DMA: 0,
      mbiRegime: regime,
      mbiEm: mbiResult.mbi.em,
      mbiSource: mbiResult.mbi.source,
      createdAt: new Date().toISOString(),
    });
  } catch {
    console.log('Market: CAUTIOUS (default -- MBI unavailable)\n');
    logger.warn('workflow', 'mbi_unavailable', 'MBI data unavailable, defaulting to CAUTIOUS');
  }

  // 2. Get watchlist
  const stocks = queries.getWatchlistStocks(1, 0);
  if (stocks.length === 0) {
    console.log('No Priority 0 stocks. Run `stark import` first.');
    return;
  }
  console.log(`Watchlist: ${stocks.length} Priority 0 stocks`);
  logger.info('workflow', 'evening_start', 'Evening workflow started', { stockCount: stocks.length });

  // 3. Score batch (auto-auth + LLM handled by CommandContext)
  const symbols = stocks.map((s) => ({
    symbol: s.symbol,
    token: s.token,
    name: s.name,
  }));

  console.log(`Scoring ${symbols.length} stocks...\n`);
  const { results, context } = await engine.scoreBatch(symbols, logger.getRunId());

  logger.info('scoring', 'batch_summary', `Scored ${results.length} stocks`, {
    stocks: results.length,
    scored: results.filter(r => r.status === 'COMPLETE').length,
    errors: context.errors.length,
    apiCalls: context.apiCalls,
    cacheHits: context.cacheHits,
    cacheMisses: context.cacheMisses,
    duration_ms: (context.completedAt ?? Date.now()) - context.startedAt,
  });

  logger.info('workflow', 'state_change', 'Workflow: scoring_batch -> focus_generation', {
    from: 'scoring_batch', to: 'focus_generation', scored: results.length, regime,
    duration_ms: (context.completedAt ?? Date.now()) - context.startedAt,
  });

  // 4. Focus list (regime-aware thresholds)
  const focusParams = getFocusParams(regime);
  const focusList = generateFocusList(db, regime, registry);

  // 5. Summary
  console.log('\n--- Summary ---');
  console.log(`Scored: ${results.length} stocks (${results[0]?.status ?? 'N/A'})`);
  console.log(`Regime: ${regime} (threshold: ${focusParams.threshold}, max: ${focusParams.maxStocks})`);

  const highScores = results.filter((r) => r.totalScore >= 5);
  console.log(`High potential (total >= 5): ${highScores.length}`);

  if (focusList.stocks.length > 0) {
    console.log(`\nFocus list (${focusList.stocks.length} stocks, threshold ${focusList.threshold}):`);
    for (const s of focusList.stocks) {
      console.log(`  ${s.symbol}: ${s.totalScore}/${s.maxScore}`);
    }
  }

  if (results[0]?.status === 'PARTIAL') {
    const reviewQueue = results.filter((r) => r.algorithmicScore >= 3);
    if (reviewQueue.length > 0) {
      console.log(`\nReview queue: ${reviewQueue.length} stocks (algo >= 3)`);
      console.log('Run `stark review --next` to override any factors.');
    }
  }

  // 6. Context stats
  console.log('\n--- Stats ---');
  console.log(`Duration: ${((context.completedAt ?? Date.now()) - context.startedAt) / 1000}s`);
  console.log(`API calls: ${JSON.stringify(context.apiCalls)}`);
  console.log(`Cache: ${context.cacheHits} hits, ${context.cacheMisses} misses`);
  if (context.errors.length > 0) {
    console.log(`Errors: ${context.errors.length}`);
  }

  logger.info('workflow', 'evening_complete', 'Evening workflow complete', {
    totalDuration_ms: Date.now() - startTime,
    scored: results.length,
    focusCount: focusList.stocks.length,
  });
}
