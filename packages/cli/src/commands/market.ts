import { createDatabase } from '@stark/core/db/index.js';
import { MBIDataManager } from '@stark/core/mbi/data-manager.js';
import { loadConfig } from '@stark/core/config/index.js';

export async function marketCommand(_args: string[]): Promise<void> {
  const config = loadConfig();
  const { db } = createDatabase();

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
  } catch (err) {
    console.error('Could not fetch market data:', (err as Error).message);
    console.log('\nTip: Ensure sheet ID is correct in ~/.stark/config.json');
  }
}
