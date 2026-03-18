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

// ---------------------------------------------------------------------------
// Advanced Performance Analytics
// ---------------------------------------------------------------------------

export interface DrawdownResult {
  /** Peak-to-trough percentage on cumulative PnL */
  maxDrawdownPct: number;
  /** Absolute max drawdown in Rs */
  maxDrawdownAbs: number;
  /** Trade index where peak occurred */
  peakTradeIndex: number;
  /** Trade index where trough occurred */
  troughTradeIndex: number;
}

export interface StreakResult {
  /** 'W' for winning streak, 'L' for losing streak, null if no closed trades */
  type: 'W' | 'L' | null;
  /** Length of current streak */
  length: number;
}

export interface AdvancedPerformanceStats {
  maxDrawdown: DrawdownResult;
  currentStreak: StreakResult;
  longestWinStreak: number;
  longestLoseStreak: number;
  profitFactor: number | null;
  avgWinToAvgLoss: number;
  calmarRatio: number | null;
  kellyPct: number;
}

const DEFAULT_ADVANCED_STATS: AdvancedPerformanceStats = {
  maxDrawdown: { maxDrawdownPct: 0, maxDrawdownAbs: 0, peakTradeIndex: 0, troughTradeIndex: 0 },
  currentStreak: { type: null, length: 0 },
  longestWinStreak: 0,
  longestLoseStreak: 0,
  profitFactor: 0,
  avgWinToAvgLoss: 0,
  calmarRatio: null,
  kellyPct: 0,
};

export function generateAdvancedStats(closedTrades: TradeJournalEntry[]): AdvancedPerformanceStats {
  // Filter defensively for trades with exitDate and sort by exitDate ASC
  const trades = closedTrades
    .filter(t => t.exitDate != null)
    .sort((a, b) => a.exitDate!.localeCompare(b.exitDate!));

  if (trades.length < 2) {
    return { ...DEFAULT_ADVANCED_STATS };
  }

  const n = trades.length;

  // --- Max Drawdown ---
  let cumPnl = 0;
  let peak = 0;
  let peakIdx = 0;
  let maxDrawdownAbs = 0;
  let maxDrawdownPct = 0;
  let peakTradeIndex = 0;
  let troughTradeIndex = 0;

  for (let i = 0; i < n; i++) {
    cumPnl += trades[i].pnl ?? 0;
    if (cumPnl > peak) {
      peak = cumPnl;
      peakIdx = i;
    }
    const drawdownAbs = peak - cumPnl;
    if (drawdownAbs > maxDrawdownAbs) {
      maxDrawdownAbs = drawdownAbs;
      troughTradeIndex = i;
      peakTradeIndex = peakIdx;
      if (peak > 0) {
        maxDrawdownPct = (drawdownAbs / peak) * 100;
      }
    }
  }

  // --- Current Streak ---
  let currentStreakType: 'W' | 'L' | null = null;
  let currentStreakLength = 0;
  if (n > 0) {
    const lastPnl = trades[n - 1].pnl ?? 0;
    currentStreakType = lastPnl > 0 ? 'W' : 'L';
    currentStreakLength = 1;
    for (let i = n - 2; i >= 0; i--) {
      const pnl = trades[i].pnl ?? 0;
      const isWin = pnl > 0;
      if ((currentStreakType === 'W') === isWin) {
        currentStreakLength++;
      } else {
        break;
      }
    }
  }

  // --- Longest Win/Lose Streaks ---
  let longestWinStreak = 0;
  let longestLoseStreak = 0;
  let curStreakType: 'W' | 'L' | null = null;
  let curStreakLen = 0;

  for (let i = 0; i < n; i++) {
    const pnl = trades[i].pnl ?? 0;
    const isWin = pnl > 0;
    const type: 'W' | 'L' = isWin ? 'W' : 'L';
    if (type === curStreakType) {
      curStreakLen++;
    } else {
      curStreakType = type;
      curStreakLen = 1;
    }
    if (type === 'W' && curStreakLen > longestWinStreak) longestWinStreak = curStreakLen;
    if (type === 'L' && curStreakLen > longestLoseStreak) longestLoseStreak = curStreakLen;
  }

  // --- Profit Factor ---
  const grossWins = trades.filter(t => (t.pnl ?? 0) > 0).reduce((s, t) => s + (t.pnl ?? 0), 0);
  const grossLossAbs = Math.abs(trades.filter(t => (t.pnl ?? 0) <= 0).reduce((s, t) => s + (t.pnl ?? 0), 0));
  let profitFactor: number | null;
  if (grossLossAbs === 0) {
    profitFactor = grossWins > 0 ? null : 0;
  } else {
    profitFactor = grossWins / grossLossAbs;
  }

  // --- Avg Win / Avg Loss ---
  const winTrades = trades.filter(t => (t.pnl ?? 0) > 0);
  const lossTrades = trades.filter(t => (t.pnl ?? 0) <= 0);
  const avgWin = winTrades.length > 0 ? winTrades.reduce((s, t) => s + (t.pnl ?? 0), 0) / winTrades.length : 0;
  const avgLossAbs = lossTrades.length > 0
    ? Math.abs(lossTrades.reduce((s, t) => s + (t.pnl ?? 0), 0) / lossTrades.length)
    : 0;
  const avgWinToAvgLoss = avgLossAbs === 0 ? 0 : avgWin / avgLossAbs;

  // --- Calmar Ratio ---
  const totalPnl = trades.reduce((s, t) => s + (t.pnl ?? 0), 0);
  const calmarRatio = maxDrawdownAbs === 0 ? null : totalPnl / maxDrawdownAbs;

  // --- Kelly Percentage ---
  const winRate = winTrades.length / n;
  let kellyPct = 0;
  if (avgLossAbs > 0 && avgWin > 0) {
    const ratio = avgWin / avgLossAbs;
    kellyPct = (winRate - ((1 - winRate) / ratio)) * 100;
    kellyPct = Math.max(0, Math.min(100, kellyPct));
  }

  return {
    maxDrawdown: {
      maxDrawdownPct: Math.round(maxDrawdownPct * 100) / 100,
      maxDrawdownAbs: Math.round(maxDrawdownAbs * 100) / 100,
      peakTradeIndex,
      troughTradeIndex,
    },
    currentStreak: { type: currentStreakType, length: currentStreakLength },
    longestWinStreak,
    longestLoseStreak,
    profitFactor,
    avgWinToAvgLoss: Math.round(avgWinToAvgLoss * 100) / 100,
    calmarRatio: calmarRatio !== null ? Math.round(calmarRatio * 100) / 100 : null,
    kellyPct: Math.round(kellyPct * 100) / 100,
  };
}

export function generateAdvancedStatsFromDb(db: DatabaseAdapter): AdvancedPerformanceStats {
  const queries = new Queries(db);
  const closed = queries.getClosedTrades();
  return generateAdvancedStats(closed);
}
