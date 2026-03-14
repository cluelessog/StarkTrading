import { classifyRegimeFull } from '@stark/core/mbi/regime-classifier.js';
import { formatMBIDashboard } from '@stark/core/mbi/format.js';
import { logger } from '@stark/core/log/index.js';
import { createCommandContext } from '../utils/command-context.js';

export async function marketCommand(_args: string[]): Promise<void> {
  const { llmService, mbiManager } = await createCommandContext();

  console.log('=== Market Context ===\n');

  try {
    const { regime, mbi, source } = await mbiManager.getLatestRegime();
    const regimeResult = classifyRegimeFull(mbi);

    console.log(formatMBIDashboard(mbi, regimeResult));
    console.log(`\nData source: ${source}`);

    logger.info('mbi', 'market_dashboard', `Market dashboard: ${regime}`, {
      regime, em: mbi.em, source,
    });

    // LLM market narrative
    if (llmService) {
      try {
        const narrative = await llmService.analyzeOHLCV(
          `Provide a brief market narrative for the Indian stock market. Current regime: ${regime}. EM: ${mbi.em ?? 'N/A'}. 52W High %: ${mbi.pct52WH ?? 'N/A'}. 52W Low %: ${mbi.pct52WL ?? 'N/A'}. Above 200 SMA %: ${mbi.pctAbove200SMA ?? 'N/A'}. Give a 2-3 sentence assessment of market conditions and what traders should watch for.`,
          [],
        );
        console.log('\n--- AI Market Narrative ---');
        console.log(narrative.reasoning);
      } catch {
        // LLM unavailable, skip narrative
      }
    }
  } catch (err) {
    console.error('Could not fetch market data:', (err as Error).message);
    console.log('\nTip: Ensure sheet ID is correct in ~/.stark/config.json');
  }
}
