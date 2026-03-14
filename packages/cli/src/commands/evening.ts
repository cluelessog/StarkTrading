import { MBIDataManager } from '@stark/core/mbi/data-manager.js';
import { generateFocusList } from '@stark/core/mbi/focus-list.js';
import { logger } from '@stark/core/log/index.js';
import { createCommandContext } from '../utils/command-context.js';

export async function eveningCommand(_args: string[]): Promise<void> {
  const startTime = Date.now();
  const { config, db, queries, engine } = await createCommandContext();
  const registry = engine.getRegistry();

  console.log('=== Evening Workflow ===\n');

  // 1. Get watchlist
  const stocks = queries.getWatchlistStocks(1, 0);
  if (stocks.length === 0) {
    console.log('No Priority 0 stocks. Run `stark import` first.');
    return;
  }
  console.log(`Watchlist: ${stocks.length} Priority 0 stocks`);
  logger.info('workflow', 'evening_start', 'Evening workflow started', { stockCount: stocks.length });

  // 2. Score batch (auto-auth + LLM handled by CommandContext)
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

  logger.info('workflow', 'state_change', 'Workflow: scoring_batch -> market_regime', {
    from: 'scoring_batch', to: 'market_regime', scored: results.length,
    duration_ms: (context.completedAt ?? Date.now()) - context.startedAt,
  });

  // 3. Market regime
  const mbiManager = new MBIDataManager(db, { sheetId: config.sheetId });
  let regime;
  try {
    const mbiResult = await mbiManager.getLatestRegime();
    regime = mbiResult.regime;
    console.log(`Market: ${regime} (EM: ${mbiResult.mbi.em ?? 'N/A'})`);
  } catch {
    regime = 'CAUTIOUS' as const;
    console.log('Market: CAUTIOUS (default — MBI unavailable)');
    logger.warn('workflow', 'mbi_unavailable', 'MBI data unavailable, defaulting to CAUTIOUS');
  }

  logger.info('workflow', 'state_change', 'Workflow: market_regime -> focus_generation', {
    from: 'market_regime', to: 'focus_generation', regime,
  });

  // 4. Focus list
  const focusList = generateFocusList(db, regime, registry);

  // 5. Summary
  console.log('\n--- Summary ---');
  console.log(`Scored: ${results.length} stocks (${results[0]?.status ?? 'N/A'})`);

  const highScores = results.filter((r) => r.totalScore >= 5);
  console.log(`High potential (total ≥ 5): ${highScores.length}`);

  if (focusList.stocks.length > 0) {
    console.log(`\nFocus list (${focusList.stocks.length} stocks, threshold ${focusList.threshold}):`);
    for (const s of focusList.stocks) {
      console.log(`  ${s.symbol}: ${s.totalScore}/${s.maxScore}`);
    }
  }

  if (results[0]?.status === 'PARTIAL') {
    const reviewQueue = results.filter((r) => r.algorithmicScore >= 3);
    if (reviewQueue.length > 0) {
      console.log(`\nReview queue: ${reviewQueue.length} stocks (algo ≥ 3)`);
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
