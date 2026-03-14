import { classifyRegime } from '@stark/core/mbi/regime-classifier.js';
import {
  analyzeMBIScoreCorrelation,
  detectRegimeTransitions,
} from '@stark/core/mbi/analysis.js';
import { createCommandContext } from '../utils/command-context.js';

export async function mbiAnalyzeCommand(args: string[]): Promise<void> {
  const { queries } = await createCommandContext();

  // Parse --days flag (default 30)
  let days = 30;
  const daysIdx = args.indexOf('--days');
  if (daysIdx >= 0 && args[daysIdx + 1]) {
    const parsed = parseInt(args[daysIdx + 1], 10);
    if (!isNaN(parsed) && parsed > 0) days = parsed;
  }

  console.log(`=== MBI Analysis (last ${days} days) ===\n`);

  // 1. Fetch MBI history
  const mbiHistory = queries.getMBIHistory(days);
  if (mbiHistory.length === 0) {
    console.log('No MBI history found. Run `stark evening` or `stark market` to collect data.');
    return;
  }
  console.log(`MBI data points: ${mbiHistory.length}`);

  // 2. Fetch score history
  const scoreHistory = queries.getDailyAverageScores(days);
  console.log(`Score data points: ${scoreHistory.length}`);

  // 3. Correlation analysis (EM vs avg scores)
  const emValues: number[] = [];
  const avgScores: number[] = [];

  // Match MBI dates with score dates
  const scoreByDate = new Map(scoreHistory.map((s) => [s.date, s]));
  for (const mbi of mbiHistory) {
    if (mbi.em != null) {
      const score = scoreByDate.get(mbi.date);
      if (score) {
        emValues.push(mbi.em);
        avgScores.push(score.avgScore);
      }
    }
  }

  console.log(`\n--- EM vs Score Correlation ---`);
  if (emValues.length >= 2) {
    const correlation = analyzeMBIScoreCorrelation(emValues, avgScores);
    console.log(`Pearson r:      ${correlation.pearsonR.toFixed(4)}`);
    console.log(`Matched pairs:  ${correlation.sampleSize}`);
    console.log(`Interpretation: ${correlation.interpretation}`);
  } else {
    console.log('Insufficient matched data for correlation analysis.');
    console.log('Need at least 2 days with both EM values and stock scores.');
  }

  // 4. Regime transitions
  const regimeHistory = mbiHistory.map((m) => ({
    date: m.date,
    regime: m.em != null ? classifyRegime(m.em) : 'UNKNOWN',
  }));

  const transitions = detectRegimeTransitions(regimeHistory);

  console.log(`\n--- Regime Transitions ---`);
  if (transitions.length === 0) {
    const latestRegime = regimeHistory[regimeHistory.length - 1]?.regime ?? 'N/A';
    console.log(`No regime changes in the period. Current: ${latestRegime}`);
  } else {
    for (const t of transitions) {
      console.log(`  ${t.date}: ${t.from} -> ${t.to}`);
    }
    console.log(`Total transitions: ${transitions.length}`);
  }

  // 5. EM summary statistics
  const allEM = mbiHistory.filter((m) => m.em != null).map((m) => m.em!);
  if (allEM.length > 0) {
    const minEM = Math.min(...allEM);
    const maxEM = Math.max(...allEM);
    const avgEM = allEM.reduce((a, b) => a + b, 0) / allEM.length;

    console.log(`\n--- EM Statistics ---`);
    console.log(`Min:  ${minEM.toFixed(1)}`);
    console.log(`Max:  ${maxEM.toFixed(1)}`);
    console.log(`Avg:  ${avgEM.toFixed(1)}`);
    console.log(`Days: ${allEM.length}`);
  }
}
