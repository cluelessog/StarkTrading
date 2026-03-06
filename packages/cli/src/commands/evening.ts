import { createDatabase } from '@stark/core/db/index.js';
import { ScoringEngine } from '@stark/core/scoring/engine.js';
import { MBIDataManager } from '@stark/core/mbi/data-manager.js';
import { generateFocusList } from '@stark/core/mbi/focus-list.js';
import { createDefaultRegistry } from '@stark/core/scoring/registry.js';
import { MockProvider } from '@stark/core/api/mock-provider.js';
import { loadConfig } from '@stark/core/config/index.js';

export async function eveningCommand(_args: string[]): Promise<void> {
  const config = loadConfig();
  const { db, queries } = createDatabase();
  const registry = createDefaultRegistry();

  console.log('=== Evening Workflow ===\n');

  // 1. Check auth
  let provider;
  try {
    if (config.angelOne?.apiKey) {
      const { AngelOneProvider } = await import('@stark/core/api/angel-one.js');
      const p = new AngelOneProvider(config.angelOne.apiKey);
      if (p.isAuthenticated()) {
        provider = p;
        console.log('Session: VALID');
      } else {
        console.log('Session: EXPIRED — using mock data');
        console.log('Run `stark auth` to authenticate.\n');
      }
    }
  } catch { /* fall through */ }

  if (!provider) {
    provider = new MockProvider();
    console.log('Using mock data provider\n');
  }

  // 2. Get watchlist
  const stocks = queries.getWatchlistStocks(1, 0);
  if (stocks.length === 0) {
    console.log('No Priority 0 stocks. Run `stark import` first.');
    return;
  }
  console.log(`Watchlist: ${stocks.length} Priority 0 stocks`);

  // 3. Score batch
  const engine = new ScoringEngine(provider, db, registry);
  const symbols = stocks.map((s) => ({
    symbol: s.symbol,
    token: s.token,
    name: s.name,
  }));

  console.log(`Scoring ${symbols.length} stocks...\n`);
  const { results, context } = await engine.scoreBatch(symbols);

  // 4. Market regime
  const mbiManager = new MBIDataManager(db, { sheetId: config.sheetId });
  let regime;
  try {
    const mbiResult = await mbiManager.getLatestRegime();
    regime = mbiResult.regime;
    console.log(`Market: ${regime} (EM: ${mbiResult.mbi.em ?? 'N/A'})`);
  } catch {
    regime = 'CAUTIOUS' as const;
    console.log('Market: CAUTIOUS (default — MBI unavailable)');
  }

  // 5. Focus list from already-COMPLETE scores
  const focusList = generateFocusList(db, regime, registry);

  // 6. Summary
  console.log('\n--- Summary ---');
  console.log(`Scored: ${results.length} stocks`);

  const highScores = results.filter((r) => r.algorithmicScore >= 5);
  console.log(`High potential (algo ≥ 5): ${highScores.length}`);

  if (focusList.stocks.length > 0) {
    console.log(`\nFocus list (${focusList.stocks.length} stocks, threshold ${focusList.threshold}):`);
    for (const s of focusList.stocks) {
      console.log(`  ${s.symbol}: ${s.totalScore}/${s.maxScore}`);
    }
  }

  const reviewQueue = results.filter((r) => r.algorithmicScore >= 3);
  if (reviewQueue.length > 0) {
    console.log(`\nReview queue: ${reviewQueue.length} stocks (algo ≥ 3)`);
    console.log('Run `stark review --next` to start reviewing.');
  }

  // 7. Context stats
  console.log('\n--- Stats ---');
  console.log(`Duration: ${((context.completedAt ?? Date.now()) - context.startedAt) / 1000}s`);
  console.log(`API calls: ${JSON.stringify(context.apiCalls)}`);
  console.log(`Cache: ${context.cacheHits} hits, ${context.cacheMisses} misses`);
  if (context.errors.length > 0) {
    console.log(`Errors: ${context.errors.length}`);
  }
}
