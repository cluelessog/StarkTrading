import { createDatabase } from '@stark/core/db/index.js';
import { createDefaultRegistry } from '@stark/core/scoring/registry.js';
import { logger } from '@stark/core/log/index.js';
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

  // Get stocks that may need override review
  // With LLM scoring, all stocks are COMPLETE — show those with total ≥ 3
  const candidates = db.query<{
    id: number;
    symbol: string;
    token: string;
    name: string;
    algorithmic_score: number;
    discretionary_score: number;
    total_score: number;
    status: string;
    score_breakdown_json: string;
    ep_catalyst: number | null;
    sector_strength: number | null;
    high_rs: number | null;
    ipo_recency: number | null;
    thrust_power: number | null;
    pivot_location: number | null;
    pattern_quality: number | null;
    pivot_level_proximity: number | null;
    linearity: number | null;
    not_pivot_cutter: number | null;
    aoi: number | null;
    hve_hvy: number | null;
    hvq_2_5: number | null;
  }>(
    `SELECT id, symbol, token, name, algorithmic_score, discretionary_score, total_score,
            status,
            score_breakdown_json,
            ep_catalyst, sector_strength, high_rs, ipo_recency,
            thrust_power, pivot_location, pattern_quality, pivot_level_proximity,
            linearity, not_pivot_cutter, aoi, hve_hvy, hvq_2_5
     FROM stock_scores
     WHERE status = 'PARTIAL'
     ORDER BY total_score DESC`,
  );

  if (candidates.length === 0) {
    console.log('No unreviewed stocks. Run stark score --all first.');
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
    console.log(`Override Review: ${candidates.length} stocks\n`);
    for (const c of candidates) {
      console.log(`  ${c.symbol.padEnd(15)} Total: ${c.total_score}/13  Status: ${c.status}  ${c.name}`);
    }
    console.log(`\nRun: stark review --next  or  stark review --symbol=SYMBOL`);
    return;
  }

  logger.info('workflow', 'review_start', 'Review workflow started', { candidates: toReview.length });

  let overrideTotal = 0;
  for (const stock of toReview) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`OVERRIDE REVIEW: ${stock.symbol} — ${stock.name}`);
    console.log(`${'='.repeat(60)}`);

    // Show full score breakdown
    console.log(`\nTotal Score: ${stock.total_score}/13`);
    console.log(`  Algorithmic: ${stock.algorithmic_score}  Discretionary: ${stock.discretionary_score}\n`);

    const allFactors = [
      { id: 'ep_catalyst', name: 'EP Catalyst', val: stock.ep_catalyst },
      { id: 'sector_strength', name: 'Sector Strength', val: stock.sector_strength },
      { id: 'high_rs', name: 'High RS', val: stock.high_rs },
      { id: 'ipo_recency', name: 'IPO Recency', val: stock.ipo_recency },
      { id: 'thrust_power', name: 'Thrust Power', val: stock.thrust_power },
      { id: 'pivot_location', name: 'Pivot Location', val: stock.pivot_location },
      { id: 'pattern_quality', name: 'Pattern Quality', val: stock.pattern_quality },
      { id: 'pivot_level_proximity', name: 'Pivot Proximity', val: stock.pivot_level_proximity },
      { id: 'linearity', name: 'Linearity', val: stock.linearity },
      { id: 'not_pivot_cutter', name: 'NOT Pivot Cutter', val: stock.not_pivot_cutter },
      { id: 'aoi', name: 'Area of Interest', val: stock.aoi },
      { id: 'hve_hvy', name: 'HVE/HVY', val: stock.hve_hvy },
      { id: 'hvq_2_5', name: '2.5 HVQ', val: stock.hvq_2_5 },
    ];

    for (const f of allFactors) {
      const mark = (f.val ?? 0) > 0 ? '✓' : '✗';
      console.log(`  ${mark} ${f.name}: ${f.val ?? 0}`);
    }

    // TradingView deep link
    console.log(`\n  TradingView: https://www.tradingview.com/chart/?symbol=NSE:${stock.symbol}`);

    // Override review (optional)
    console.log('\n--- Override Review (optional) ---\n');

    const wantOverride = await askYesNo('Override any factor?');
    let overrideCount = 0;
    const factorUpdates: Record<string, number> = {};
    let newAlgo = stock.algorithmic_score;
    let newDisc = stock.discretionary_score;

    if (wantOverride) {
      for (const f of allFactors) {
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

      // Recalculate scores with overrides
      const semiDiscIds = new Set(['pattern_quality', 'linearity', 'not_pivot_cutter', 'aoi', 'hve_hvy', 'hvq_2_5']);
      newAlgo = 0;
      newDisc = 0;
      for (const f of allFactors) {
        const val = factorUpdates[f.id] ?? f.val ?? 0;
        if (semiDiscIds.has(f.id)) {
          newDisc += val;
        } else {
          newAlgo += val;
        }
      }
    }

    const totalScore = newAlgo + newDisc;

    console.log(`\n--- Final Score ---`);
    console.log(`  Algorithmic: ${newAlgo}`);
    console.log(`  Discretionary: ${newDisc}`);
    console.log(`  Total: ${totalScore} / ${registry.maxScore()}`);
    console.log(`  Overrides: ${overrideCount}`);

    // Always persist review (even with 0 overrides) — sets status=COMPLETE
    const finalFactors: Record<string, number> = {};
    for (const f of allFactors) {
      finalFactors[f.id] = factorUpdates[f.id] ?? f.val ?? 0;
    }

    // Rebuild score_breakdown_json from factor columns
    const breakdownJson = JSON.stringify({
      factors: allFactors.map(f => ({
        factorId: f.id,
        factorName: f.name,
        score: finalFactors[f.id],
        maxScore: 1,
      })),
      algorithmicScore: newAlgo,
      discretionaryScore: newDisc,
      totalScore,
      maxPossibleScore: registry.maxScore(),
    });

    db.execute(
      `UPDATE stock_scores SET
         ep_catalyst = ?,
         sector_strength = ?,
         high_rs = ?,
         ipo_recency = ?,
         thrust_power = ?,
         pivot_location = ?,
         pattern_quality = ?,
         pivot_level_proximity = ?,
         linearity = ?,
         not_pivot_cutter = ?,
         aoi = ?,
         hve_hvy = ?,
         hvq_2_5 = ?,
         algorithmic_score = ?,
         discretionary_score = ?,
         total_score = ?,
         override_count = ?,
         score_breakdown_json = ?,
         status = 'COMPLETE',
         reviewed_at = datetime('now'),
         updated_at = datetime('now')
       WHERE id = ?`,
      [
        finalFactors['ep_catalyst'],
        finalFactors['sector_strength'],
        finalFactors['high_rs'],
        finalFactors['ipo_recency'],
        finalFactors['thrust_power'],
        finalFactors['pivot_location'],
        finalFactors['pattern_quality'],
        finalFactors['pivot_level_proximity'],
        finalFactors['linearity'],
        finalFactors['not_pivot_cutter'],
        finalFactors['aoi'],
        finalFactors['hve_hvy'],
        finalFactors['hvq_2_5'],
        newAlgo,
        newDisc,
        totalScore,
        overrideCount,
        breakdownJson,
        stock.id,
      ],
    );
    console.log(`  Review saved (status: COMPLETE, overrides: ${overrideCount}).\n`);
    overrideTotal += overrideCount;
  }

  logger.info('workflow', 'review_complete', 'Review complete', {
    reviewed: toReview.length,
    overrides: overrideTotal,
  });

  closePrompts();
}
