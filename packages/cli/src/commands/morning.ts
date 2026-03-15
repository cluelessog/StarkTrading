import { logger } from '@stark/core/log/index.js';
import { classifyRegimeFull } from '@stark/core/mbi/regime-classifier.js';
import { generateFocusList } from '@stark/core/mbi/focus-list.js';
import type { MBIRegime } from '@stark/core/models/market.js';
import { createCommandContext } from '../utils/command-context.js';

export async function morningCommand(_args: string[]): Promise<void> {
  const startTime = Date.now();
  const { db, queries, provider, llmService, mbiManager, engine } = await createCommandContext();

  console.log('=== Morning Workflow ===\n');

  // 1. Check current MBI regime
  let currentRegime: MBIRegime | null = null;
  try {
    const mbiResult = await mbiManager.getLatestRegime();
    const regimeResult = classifyRegimeFull(mbiResult.mbi);
    currentRegime = regimeResult.regime;
    console.log(`Current Regime: ${regimeResult.regime} (EM: ${mbiResult.mbi.em ?? 'N/A'}, source: ${mbiResult.source})`);

    logger.info('mbi', 'regime_fetched', `Regime: ${regimeResult.regime}`, {
      regime: regimeResult.regime, em: mbiResult.mbi.em, source: mbiResult.source,
    });

    // Check for regime change from yesterday
    const yesterdayCtx = queries.getLatestMarketContext();
    if (yesterdayCtx && yesterdayCtx.mbiRegime && yesterdayCtx.mbiRegime !== regimeResult.regime) {
      console.log(`  *** REGIME CHANGE: ${yesterdayCtx.mbiRegime} -> ${regimeResult.regime} ***`);
      console.log(`  Review position sizing and focus list thresholds.`);
      logger.warn('mbi', 'regime_change', `Regime changed: ${yesterdayCtx.mbiRegime} -> ${regimeResult.regime}`, {
        from: yesterdayCtx.mbiRegime, to: regimeResult.regime,
      });
    }
    console.log('');
  } catch {
    console.log('MBI regime unavailable. Using last known context.\n');
    logger.warn('mbi', 'mbi_unavailable', 'MBI regime unavailable, using last known context');
    const lastCtx = queries.getLatestMarketContext();
    if (lastCtx?.mbiRegime) {
      currentRegime = lastCtx.mbiRegime;
      console.log(`Last known regime: ${lastCtx.mbiRegime} (${lastCtx.date})\n`);
    }
  }

  // 2. Get focus list stocks
  const registry = engine.getRegistry();
  const focusList = generateFocusList(db, currentRegime ?? 'CAUTIOUS', registry, { includePartial: true });
  const focusStocks = focusList.stocks;

  if (focusStocks.length === 0) {
    console.log('No focus stocks. Run `stark evening` first.');
    return;
  }

  console.log(`Focus stocks (${focusStocks.length})${currentRegime ? ` | Regime: ${currentRegime}` : ''}:\n`);
  logger.info('workflow', 'morning_start', 'Morning workflow started', { focusCount: focusStocks.length, regime: currentRegime });

  logger.info('workflow', 'state_change', 'Workflow: regime_check -> news_fetch', {
    from: 'regime_check', to: 'news_fetch', regime: currentRegime,
  });

  // 3. Overnight news via Perplexity (if LLM enabled)
  if (llmService) {
    const symbolList = focusStocks.map((s) => s.symbol).join(', ');
    try {
      const news = await llmService.research(
        `What are the overnight developments and pre-market news for these NSE India stocks: ${symbolList}? Focus on earnings, corporate actions, regulatory changes, or major events from the last 12 hours. Be brief.`,
      );
      console.log('--- Overnight News ---');
      console.log(news.answer);
      if (news.sources.length > 0) {
        console.log(`Sources: ${news.sources.join(', ')}`);
      }
      console.log('');
    } catch {
      console.log('(Overnight news unavailable)\n');
    }
  }

  logger.info('workflow', 'state_change', 'Workflow: news_fetch -> quote_check', {
    from: 'news_fetch', to: 'quote_check', newsAvailable: !!llmService,
  });

  // 4. Check quotes and gaps
  for (const stock of focusStocks) {
    try {
      const quote = await provider.fetchQuote(stock.symbol, stock.token);
      const gapPct = quote.close > 0
        ? ((quote.open - quote.close) / quote.close) * 100
        : 0;

      const gapFlag = Math.abs(gapPct) > 3 ? ' !! GAP' : '';
      console.log(
        `  ${stock.symbol.padEnd(15)} Score: ${stock.totalScore}  LTP: ${quote.ltp}  Gap: ${gapPct >= 0 ? '+' : ''}${gapPct.toFixed(1)}%${gapFlag}`,
      );

      if (Math.abs(gapPct) > 3) {
        console.log(`    -> Gap >3% detected. Re-validate setup before entry.`);
      }
    } catch (err) {
      console.log(`  ${stock.symbol.padEnd(15)} Error: ${(err as Error).message}`);
    }
  }

  console.log('\nDone. Review any flagged stocks before trading.');

  logger.info('workflow', 'morning_complete', 'Morning workflow complete', {
    totalDuration_ms: Date.now() - startTime,
    focusCount: focusStocks.length,
  });
}
