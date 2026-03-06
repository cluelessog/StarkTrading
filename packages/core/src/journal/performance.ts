import type { DatabaseAdapter } from '../db/adapter.js';
import { Queries, type TradeJournalEntry } from '../db/queries.js';

export interface PerformanceStats {
  totalTrades: number;
  openTrades: number;
  closedTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  avgRMultiple: number;
  totalPnl: number;
  expectancy: number;
  avgHoldDays: number;
  sufficientData: boolean;
  minTradesNeeded: number;
}

export interface BreakdownEntry {
  label: string;
  trades: number;
  winRate: number;
  avgR: number;
  totalPnl: number;
}

export interface PerformanceReport {
  overall: PerformanceStats;
  byScoreRange: BreakdownEntry[];
  byRegime: BreakdownEntry[];
  bySector: BreakdownEntry[];
  byConviction: BreakdownEntry[];
  overrideAccuracy: { withOverrides: number; withoutOverrides: number; overrideWinRate: number; noOverrideWinRate: number } | null;
}

const MIN_TRADES = 20;

function computeBreakdown(trades: TradeJournalEntry[], groupFn: (t: TradeJournalEntry) => string): BreakdownEntry[] {
  const groups = new Map<string, TradeJournalEntry[]>();
  for (const t of trades) {
    const key = groupFn(t);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(t);
  }

  return Array.from(groups.entries()).map(([label, group]) => {
    const wins = group.filter(t => (t.pnl ?? 0) > 0).length;
    const totalR = group.reduce((s, t) => s + (t.rMultiple ?? 0), 0);
    const totalPnl = group.reduce((s, t) => s + (t.pnl ?? 0), 0);
    return {
      label,
      trades: group.length,
      winRate: Math.round((wins / group.length) * 100),
      avgR: Math.round((totalR / group.length) * 100) / 100,
      totalPnl: Math.round(totalPnl),
    };
  }).sort((a, b) => b.trades - a.trades);
}

function scoreRangeBucket(score: number | null): string {
  if (score == null) return 'Unknown';
  if (score >= 10) return '10+';
  if (score >= 8) return '8-10';
  if (score >= 6) return '6-8';
  return '<6';
}

export function generatePerformanceReport(db: DatabaseAdapter): PerformanceReport {
  const queries = new Queries(db);
  const allTrades = queries.getAllTrades();
  const closed = allTrades.filter(t => t.status === 'CLOSED');
  const open = allTrades.filter(t => t.status === 'OPEN');

  const wins = closed.filter(t => (t.pnl ?? 0) > 0);
  const losses = closed.filter(t => (t.pnl ?? 0) <= 0);

  const avgWin = wins.length > 0
    ? wins.reduce((s, t) => s + (t.pnl ?? 0), 0) / wins.length
    : 0;
  const avgLoss = losses.length > 0
    ? Math.abs(losses.reduce((s, t) => s + (t.pnl ?? 0), 0) / losses.length)
    : 0;

  const totalPnl = closed.reduce((s, t) => s + (t.pnl ?? 0), 0);
  const totalR = closed.reduce((s, t) => s + (t.rMultiple ?? 0), 0);
  const avgR = closed.length > 0 ? totalR / closed.length : 0;
  const avgHoldDays = closed.length > 0
    ? closed.reduce((s, t) => s + (t.holdDays ?? 0), 0) / closed.length
    : 0;

  const winRate = closed.length > 0 ? (wins.length / closed.length) * 100 : 0;
  const expectancy = closed.length > 0
    ? (winRate / 100) * avgWin - ((100 - winRate) / 100) * avgLoss
    : 0;

  const sufficientData = closed.length >= MIN_TRADES;

  const overall: PerformanceStats = {
    totalTrades: allTrades.length,
    openTrades: open.length,
    closedTrades: closed.length,
    wins: wins.length,
    losses: losses.length,
    winRate: Math.round(winRate * 10) / 10,
    avgWin: Math.round(avgWin),
    avgLoss: Math.round(avgLoss),
    avgRMultiple: Math.round(avgR * 100) / 100,
    totalPnl: Math.round(totalPnl),
    expectancy: Math.round(expectancy),
    avgHoldDays: Math.round(avgHoldDays * 10) / 10,
    sufficientData,
    minTradesNeeded: sufficientData ? 0 : MIN_TRADES - closed.length,
  };

  const byScoreRange = computeBreakdown(closed, t => scoreRangeBucket(t.scoreAtEntry));
  const byRegime = computeBreakdown(closed, t => t.marketRegimeAtEntry ?? 'Unknown');
  const bySector = computeBreakdown(closed, t => t.sectorAtEntry ?? 'Unknown');
  const byConviction = computeBreakdown(closed, t => t.conviction ?? 'Unknown');

  // Override accuracy
  let overrideAccuracy = null;
  if (closed.length >= 10) {
    const withOverrides = closed.filter(t => t.overrideCount > 0);
    const withoutOverrides = closed.filter(t => t.overrideCount === 0);
    const overrideWins = withOverrides.filter(t => (t.pnl ?? 0) > 0).length;
    const noOverrideWins = withoutOverrides.filter(t => (t.pnl ?? 0) > 0).length;

    overrideAccuracy = {
      withOverrides: withOverrides.length,
      withoutOverrides: withoutOverrides.length,
      overrideWinRate: withOverrides.length > 0
        ? Math.round((overrideWins / withOverrides.length) * 100)
        : 0,
      noOverrideWinRate: withoutOverrides.length > 0
        ? Math.round((noOverrideWins / withoutOverrides.length) * 100)
        : 0,
    };
  }

  return {
    overall,
    byScoreRange,
    byRegime,
    bySector,
    byConviction,
    overrideAccuracy,
  };
}
