import { createDatabase } from '@stark/core/db/index.js';
import { MockProvider } from '@stark/core/api/mock-provider.js';
import { loadConfig } from '@stark/core/config/index.js';

export async function morningCommand(_args: string[]): Promise<void> {
  const config = loadConfig();
  const { db } = createDatabase();

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

  // 2. Check overnight gaps
  let provider;
  try {
    if (config.angelOne?.apiKey) {
      const { AngelOneProvider } = await import('@stark/core/api/angel-one.js');
      const p = new AngelOneProvider(config.angelOne.apiKey);
      if (p.isAuthenticated()) provider = p;
    }
  } catch { /* fall through */ }

  if (!provider) {
    provider = new MockProvider();
  }

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
