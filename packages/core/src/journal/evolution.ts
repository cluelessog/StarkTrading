import type { DatabaseAdapter } from '../db/adapter.js';
import { Queries, type TradeJournalEntry } from '../db/queries.js';
import type { ScoreBreakdown, FactorResult } from '../models/score.js';

export interface FactorEdge {
  factorId: string;
  factorName: string;
  presentWinRate: number;
  absentWinRate: number;
  edge: number;
  tradesWith: number;
  tradesWithout: number;
}

export interface EvolutionReport {
  sufficientData: boolean;
  minTradesNeeded: number;
  closedTrades: number;
  factorEdges: FactorEdge[];
  recommendations: string[];
  discretionaryAccuracy: { factorId: string; factorName: string; winRate: number; trades: number }[];
}

const MIN_EVOLUTION_TRADES = 30;
const MIN_FACTOR_SAMPLE = 5;

export function generateEvolutionReport(db: DatabaseAdapter): EvolutionReport {
  const queries = new Queries(db);
  const closed = queries.getClosedTrades();

  if (closed.length < MIN_EVOLUTION_TRADES) {
    return {
      sufficientData: false,
      minTradesNeeded: MIN_EVOLUTION_TRADES - closed.length,
      closedTrades: closed.length,
      factorEdges: [],
      recommendations: [`Need ${MIN_EVOLUTION_TRADES - closed.length} more closed trades for evolution analysis.`],
      discretionaryAccuracy: [],
    };
  }

  // Parse score breakdowns
  const tradesWithBreakdowns: { trade: TradeJournalEntry; breakdown: ScoreBreakdown }[] = [];
  for (const t of closed) {
    if (t.scoreBreakdownJson) {
      try {
        const breakdown = JSON.parse(t.scoreBreakdownJson) as ScoreBreakdown;
        tradesWithBreakdowns.push({ trade: t, breakdown });
      } catch {
        // skip invalid JSON
      }
    }
  }

  if (tradesWithBreakdowns.length < MIN_EVOLUTION_TRADES) {
    return {
      sufficientData: false,
      minTradesNeeded: MIN_EVOLUTION_TRADES - tradesWithBreakdowns.length,
      closedTrades: closed.length,
      factorEdges: [],
      recommendations: ['Not enough trades with score breakdown data for factor analysis.'],
      discretionaryAccuracy: [],
    };
  }

  // Compute factor edges
  const factorMap = new Map<string, { name: string; present: TradeJournalEntry[]; absent: TradeJournalEntry[] }>();

  for (const { trade, breakdown } of tradesWithBreakdowns) {
    for (const factor of breakdown.factors) {
      if (!factorMap.has(factor.factorId)) {
        factorMap.set(factor.factorId, { name: factor.factorName, present: [], absent: [] });
      }
      const entry = factorMap.get(factor.factorId)!;
      if (factor.score > 0) {
        entry.present.push(trade);
      } else {
        entry.absent.push(trade);
      }
    }
  }

  const factorEdges: FactorEdge[] = [];
  for (const [factorId, data] of factorMap) {
    if (data.present.length < MIN_FACTOR_SAMPLE || data.absent.length < MIN_FACTOR_SAMPLE) continue;

    const presentWins = data.present.filter(t => (t.pnl ?? 0) > 0).length;
    const absentWins = data.absent.filter(t => (t.pnl ?? 0) > 0).length;
    const presentWinRate = Math.round((presentWins / data.present.length) * 100);
    const absentWinRate = Math.round((absentWins / data.absent.length) * 100);

    factorEdges.push({
      factorId,
      factorName: data.name,
      presentWinRate,
      absentWinRate,
      edge: presentWinRate - absentWinRate,
      tradesWith: data.present.length,
      tradesWithout: data.absent.length,
    });
  }

  factorEdges.sort((a, b) => b.edge - a.edge);

  // Discretionary factor accuracy
  const discretionaryIds = ['linearity', 'not_pivot_cutter', 'aoi', 'hve_hvy', 'hvq_2_5'];
  const discretionaryAccuracy = discretionaryIds
    .map(fid => {
      const data = factorMap.get(fid);
      if (!data || data.present.length < MIN_FACTOR_SAMPLE) return null;
      const wins = data.present.filter(t => (t.pnl ?? 0) > 0).length;
      return {
        factorId: fid,
        factorName: data.name,
        winRate: Math.round((wins / data.present.length) * 100),
        trades: data.present.length,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  // Generate recommendations
  const recommendations: string[] = [];
  const topEdge = factorEdges[0];
  const bottomEdge = factorEdges[factorEdges.length - 1];

  if (topEdge && topEdge.edge > 15) {
    recommendations.push(`${topEdge.factorName} is your strongest edge (+${topEdge.edge}% win rate when present). Prioritize stocks with this factor.`);
  }
  if (bottomEdge && bottomEdge.edge < -10) {
    recommendations.push(`${bottomEdge.factorName} shows negative edge (${bottomEdge.edge}%). Consider whether this factor adds value for your style.`);
  }

  const highConviction = closed.filter(t => t.conviction === 'HIGH');
  const lowConviction = closed.filter(t => t.conviction === 'LOW');
  if (highConviction.length >= MIN_FACTOR_SAMPLE && lowConviction.length >= MIN_FACTOR_SAMPLE) {
    const highWinRate = highConviction.filter(t => (t.pnl ?? 0) > 0).length / highConviction.length;
    const lowWinRate = lowConviction.filter(t => (t.pnl ?? 0) > 0).length / lowConviction.length;
    if (highWinRate > lowWinRate + 0.1) {
      recommendations.push(`HIGH conviction trades win ${Math.round(highWinRate * 100)}% vs LOW at ${Math.round(lowWinRate * 100)}%. Trust your conviction calls.`);
    }
  }

  if (recommendations.length === 0) {
    recommendations.push('Keep logging trades — clearer patterns will emerge with more data.');
  }

  return {
    sufficientData: true,
    minTradesNeeded: 0,
    closedTrades: closed.length,
    factorEdges,
    recommendations,
    discretionaryAccuracy,
  };
}
