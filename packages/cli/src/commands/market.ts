import { MBIDataManager } from '@stark/core/mbi/data-manager.js';
import { createCommandContext } from '../utils/command-context.js';

export async function marketCommand(_args: string[]): Promise<void> {
  const { config, db, llmService } = await createCommandContext();

  const manager = new MBIDataManager(db, {
    sheetId: config.sheetId,
  });

  console.log('=== Market Context ===\n');

  try {
    const { regime, mbi, source } = await manager.getLatestRegime();

    console.log(`Regime: ${regime}`);
    console.log(`EM: ${mbi.em ?? 'N/A'}`);
    console.log(`Source: ${source}`);
    console.log(`Date: ${mbi.date}`);
    console.log(`Freshness: ${mbi.dataFreshness}`);
    console.log('');

    if (mbi.pct52WH || mbi.pct52WL) {
      console.log('Breadth:');
      if (mbi.pct52WH) console.log(`  52W High %: ${mbi.pct52WH}`);
      if (mbi.pct52WL) console.log(`  52W Low %: ${mbi.pct52WL}`);
      if (mbi.pctAbove200SMA) console.log(`  > 200 SMA %: ${mbi.pctAbove200SMA}`);
    }

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
