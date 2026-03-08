import { createCommandContext } from '../utils/command-context.js';

export async function morningCommand(_args: string[]): Promise<void> {
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

  // 2. Overnight news via Perplexity (if LLM enabled)
  if (llmService) {
    const symbolList = focusStocks.map((s) => s.symbol).join(', ');
    try {
      const config = { enabled: true, perplexityKey: 'check', cacheResponses: true, cacheTtlHours: 24 };
      const news = await llmService.research(
        `What are the overnight developments and pre-market news for these NSE India stocks: ${symbolList}? Focus on earnings, corporate actions, regulatory changes, or major events from the last 12 hours. Be brief.`,
        config,
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
}
