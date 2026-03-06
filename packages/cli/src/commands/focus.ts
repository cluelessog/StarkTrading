import { createDatabase } from '@stark/core/db/index.js';
import { MBIDataManager } from '@stark/core/mbi/data-manager.js';
import { generateFocusList } from '@stark/core/mbi/focus-list.js';
import { createDefaultRegistry } from '@stark/core/scoring/registry.js';
import { loadConfig } from '@stark/core/config/index.js';

export async function focusCommand(_args: string[]): Promise<void> {
  const config = loadConfig();
  const { db } = createDatabase();
  const registry = createDefaultRegistry();

  const manager = new MBIDataManager(db, {
    sheetId: config.sheetId,
  });

  let regime;
  try {
    const result = await manager.getLatestRegime();
    regime = result.regime;
    console.log(`Market Regime: ${regime} (EM: ${result.mbi.em ?? 'N/A'}, source: ${result.source})\n`);
  } catch {
    regime = 'CAUTIOUS' as const;
    console.log('Market regime unavailable, using CAUTIOUS as default\n');
  }

  const focusList = generateFocusList(db, regime, registry);

  console.log(`Threshold: ${focusList.threshold} (${regime})`);
  console.log(`Max stocks: ${focusList.maxStocks}\n`);

  if (focusList.stocks.length === 0) {
    console.log('No stocks qualify for the focus list.');
    console.log('Ensure stocks are scored (COMPLETE) with scores above threshold.');
    return;
  }

  console.log('--- Focus List ---\n');
  for (let i = 0; i < focusList.stocks.length; i++) {
    const s = focusList.stocks[i];
    console.log(`${i + 1}. ${s.symbol.padEnd(15)} Score: ${s.totalScore}/${s.maxScore}  (A:${s.algorithmicScore} D:${s.discretionaryScore})`);
  }

  // Unreviewed stocks warning
  const unreviewed = db.queryOne<{ count: number }>(
    `SELECT COUNT(*) as count FROM stock_scores WHERE status = 'PARTIAL' AND algorithmic_score >= 3`,
  );
  if (unreviewed && unreviewed.count > 0) {
    console.log(`\nNote: ${unreviewed.count} stocks MIGHT qualify if reviewed. Run \`stark review\`.`);
  }
}
