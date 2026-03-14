import { logger } from '@stark/core/log/index.js';
import { createCommandContext } from '../utils/command-context.js';

export async function morningCommand(_args: string[]): Promise<void> {
  const startTime = Date.now();
  const { db, provider, llmService } = await createCommandContext();

  console.log('=== Morning Workflow ===\n');

  // 1. Get focus list stocks
  const focusStocks = db.query<{
    symbol: string;
    token: string;
    total_score: number;
  }>(
    `SELECT symbol, token, total_score FROM stock_scores
     WHERE status = 'COMPLETE'
     ORDER BY total_score DESC LIMIT 5`,
  );

  if (focusStocks.length === 0) {
    console.log('No focus stocks. Run `stark evening` first.');
    return;
  }

  console.log(`Checking ${focusStocks.length} focus stocks...\n`);
  logger.info('workflow', 'morning_start', 'Morning workflow started', { focusCount: focusStocks.length });

  // 2. Overnight news via Perplexity (if LLM enabled)
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

  // 3. Check quotes and gaps
  for (const stock of focusStocks) {
    try {
      const quote = await provider.fetchQuote(stock.symbol, stock.token);
      const gapPct = quote.close > 0
        ? ((quote.open - quote.close) / quote.close) * 100
        : 0;

      const gapFlag = Math.abs(gapPct) > 3 ? ' ⚠ GAP' : '';
      console.log(
        `  ${stock.symbol.padEnd(15)} Score: ${stock.total_score}  LTP: ${quote.ltp}  Gap: ${gapPct >= 0 ? '+' : ''}${gapPct.toFixed(1)}%${gapFlag}`,
      );

      if (Math.abs(gapPct) > 3) {
        console.log(`    → Gap >3% detected. Re-validate setup before entry.`);
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
