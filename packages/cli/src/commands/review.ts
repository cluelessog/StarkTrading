import { createDatabase } from '@stark/core/db/index.js';
import { createDefaultRegistry } from '@stark/core/scoring/registry.js';
import {
  askYesNo,
  askGraduated,
  askOptionalText,
  closePrompts,
} from '../prompts/review-prompts.js';

export async function reviewCommand(args: string[]): Promise<void> {
  const symbolArg = args.find((a) => a.startsWith('--symbol='))?.split('=')[1];
  const nextMode = args.includes('--next');

  const { db, queries } = createDatabase();
  const registry = createDefaultRegistry();

  // Get review queue: PARTIAL scores with algorithmic score >= 3
  const candidates = db.query<{
    id: number;
    symbol: string;
    token: string;
    name: string;
    algorithmic_score: number;
    score_breakdown_json: string;
    ep_catalyst: number | null;
    sector_strength: number | null;
    high_rs: number | null;
    ipo_recency: number | null;
    thrust_power: number | null;
    pivot_location: number | null;
    pattern_quality: number | null;
    pivot_level_proximity: number | null;
  }>(
    `SELECT id, symbol, token, name, algorithmic_score, score_breakdown_json,
            ep_catalyst, sector_strength, high_rs, ipo_recency,
            thrust_power, pivot_location, pattern_quality, pivot_level_proximity
     FROM stock_scores
     WHERE status = 'PARTIAL' AND algorithmic_score >= 3
     ORDER BY algorithmic_score DESC`,
  );

  if (candidates.length === 0) {
    console.log('No stocks in review queue (need PARTIAL scores with algo score >= 3)');
    console.log('Run `stark score --all` first.');
    return;
  }

  let toReview;
  if (symbolArg) {
    toReview = candidates.filter((c) => c.symbol === symbolArg.toUpperCase());
    if (toReview.length === 0) {
      console.error(`Symbol ${symbolArg} not found in review queue.`);
      return;
    }
  } else if (nextMode) {
    toReview = [candidates[0]];
  } else {
    // Show queue
    console.log(`Review queue: ${candidates.length} stocks\n`);
    for (const c of candidates) {
      console.log(`  ${c.symbol.padEnd(15)} Algo: ${c.algorithmic_score}/8  ${c.name}`);
    }
    console.log(`\nRun: stark review --next  or  stark review --symbol=SYMBOL`);
    return;
  }

  for (const stock of toReview) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`REVIEW: ${stock.symbol} — ${stock.name}`);
    console.log(`${'='.repeat(60)}`);

    // Show algorithmic breakdown
    console.log(`\nAlgorithmic Score: ${stock.algorithmic_score}/8\n`);

    const algoFactors = [
      { id: 'ep_catalyst', name: 'EP Catalyst', val: stock.ep_catalyst },
      { id: 'sector_strength', name: 'Sector Strength', val: stock.sector_strength },
      { id: 'high_rs', name: 'High RS', val: stock.high_rs },
      { id: 'ipo_recency', name: 'IPO Recency', val: stock.ipo_recency },
      { id: 'thrust_power', name: 'Thrust Power', val: stock.thrust_power },
      { id: 'pivot_location', name: 'Pivot Location', val: stock.pivot_location },
      { id: 'pattern_quality', name: 'Pattern Quality', val: stock.pattern_quality },
      { id: 'pivot_level_proximity', name: 'Pivot Proximity', val: stock.pivot_level_proximity },
    ];

    for (const f of algoFactors) {
      const mark = (f.val ?? 0) > 0 ? '✓' : '✗';
      console.log(`  ${mark} ${f.name}: ${f.val ?? 0}`);
    }

    // TradingView deep link
    console.log(`\n  TradingView: https://www.tradingview.com/chart/?symbol=NSE:${stock.symbol}`);

    // Discretionary review
    console.log('\n--- Discretionary Factors ---\n');

    const discretionary = registry.getDiscretionary();
    let discretionaryScore = 0;
    const factorUpdates: Record<string, number> = {};

    for (const factor of discretionary) {
      console.log(`  ${factor.name}: ${factor.description}`);
      console.log(`  Guidance: ${factor.guidanceText}`);

      let score: number;
      if (factor.scoring === 'graduated') {
        score = await askGraduated(`  Score for ${factor.name}`);
      } else if (factor.maxPoints === 0.5) {
        const yes = await askYesNo(`  ${factor.name}?`);
        score = yes ? 0.5 : 0;
      } else {
        const yes = await askYesNo(`  ${factor.name}?`);
        score = yes ? 1 : 0;
      }

      factorUpdates[factor.id] = score;
      discretionaryScore += score;
      console.log('');
    }

    // Ask for override
    const wantOverride = await askYesNo('Override any algorithmic factor?');
    let overrideCount = 0;

    if (wantOverride) {
      for (const f of algoFactors) {
        const override = await askYesNo(`  Override ${f.name} (current: ${f.val ?? 0})?`);
        if (override) {
          const newVal = await askGraduated(`    New value for ${f.name}`);
          factorUpdates[f.id] = newVal;
          overrideCount++;
          const reason = await askOptionalText('    Override reason');
          if (reason) {
            console.log(`    Logged: ${reason}`);
          }
        }
      }
    }

    // Calculate total
    const totalScore = stock.algorithmic_score + discretionaryScore;
    const maxScore = registry.maxScore();

    console.log(`\n--- Final Score ---`);
    console.log(`  Algorithmic: ${stock.algorithmic_score}`);
    console.log(`  Discretionary: ${discretionaryScore}`);
    console.log(`  Total: ${totalScore} / ${maxScore}`);
    console.log(`  Status: COMPLETE`);

    // Update DB
    db.execute(
      `UPDATE stock_scores SET
         status = 'COMPLETE',
         linearity = ?,
         not_pivot_cutter = ?,
         aoi = ?,
         hve_hvy = ?,
         hvq_2_5 = ?,
         discretionary_score = ?,
         total_score = ?,
         override_count = ?,
         reviewed_at = datetime('now'),
         updated_at = datetime('now')
       WHERE id = ?`,
      [
        factorUpdates['linearity'] ?? 0,
        factorUpdates['not_pivot_cutter'] ?? 0,
        factorUpdates['aoi'] ?? 0,
        factorUpdates['hve_hvy'] ?? 0,
        factorUpdates['hvq_2_5'] ?? 0,
        discretionaryScore,
        totalScore,
        overrideCount,
        stock.id,
      ],
    );

    console.log(`  Saved to database.\n`);
  }

  closePrompts();
}
