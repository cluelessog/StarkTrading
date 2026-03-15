import { describe, it, expect } from 'bun:test';
import { generateAdvancedStats } from '../src/journal/performance.js';
import type { TradeJournalEntry } from '../src/db/queries.js';

let idCounter = 1;

function makeTrade(overrides: Partial<TradeJournalEntry>): TradeJournalEntry {
  return {
    id: idCounter++,
    symbol: 'TEST',
    tradeType: 'swing',
    entryDate: '2026-01-01',
    entryPrice: 100,
    shares: 10,
    stopPrice: 90,
    riskAmount: 100,
    conviction: 'MEDIUM',
    status: 'CLOSED',
    exitDate: '2026-01-10',
    exitPrice: 110,
    exitReason: 'TARGET',
    pnl: 100,
    rMultiple: 1.0,
    holdDays: 10,
    scoreAtEntry: null,
    scoreBreakdownJson: null,
    marketRegimeAtEntry: null,
    sectorAtEntry: null,
    overrideCount: 0,
    createdAt: '2026-01-01',
    ...overrides,
  } as TradeJournalEntry;
}

describe('generateAdvancedStats', () => {
  it('returns defaults for insufficient data (<2 trades)', () => {
    const result = generateAdvancedStats([]);
    expect(result.maxDrawdown.maxDrawdownPct).toBe(0);
    expect(result.maxDrawdown.maxDrawdownAbs).toBe(0);
    expect(result.currentStreak.type).toBeNull();
    expect(result.currentStreak.length).toBe(0);
    expect(result.longestWinStreak).toBe(0);
    expect(result.longestLoseStreak).toBe(0);
    expect(result.profitFactor).toBe(0);
    expect(result.avgWinToAvgLoss).toBe(0);
    expect(result.calmarRatio).toBeNull();
    expect(result.kellyPct).toBe(0);

    const single = generateAdvancedStats([makeTrade({ pnl: 100, exitDate: '2026-01-10' })]);
    expect(single.maxDrawdown.maxDrawdownPct).toBe(0);
    expect(single.currentStreak.type).toBeNull();
  });

  it('max drawdown with mixed trades (W,W,L,L,W)', () => {
    // Sorted by exitDate: cumPnl after each: 200, 400, 200, 0, 150
    // Peak=400 at idx=1, trough=0 at idx=3 → drawdown = 400 abs, 100%
    const trades = [
      makeTrade({ pnl: 200, exitDate: '2026-01-01' }),
      makeTrade({ pnl: 200, exitDate: '2026-01-02' }),
      makeTrade({ pnl: -200, exitDate: '2026-01-03' }),
      makeTrade({ pnl: -200, exitDate: '2026-01-04' }),
      makeTrade({ pnl: 150, exitDate: '2026-01-05' }),
    ];
    const result = generateAdvancedStats(trades);
    expect(result.maxDrawdown.maxDrawdownAbs).toBe(400);
    expect(result.maxDrawdown.maxDrawdownPct).toBe(100);
    expect(result.maxDrawdown.peakTradeIndex).toBe(1);
    expect(result.maxDrawdown.troughTradeIndex).toBe(3);
  });

  it('max drawdown all wins returns 0 drawdown', () => {
    const trades = [
      makeTrade({ pnl: 100, exitDate: '2026-01-01' }),
      makeTrade({ pnl: 200, exitDate: '2026-01-02' }),
      makeTrade({ pnl: 150, exitDate: '2026-01-03' }),
    ];
    const result = generateAdvancedStats(trades);
    expect(result.maxDrawdown.maxDrawdownAbs).toBe(0);
    expect(result.maxDrawdown.maxDrawdownPct).toBe(0);
  });

  it('max drawdown all losses returns correct cumulative loss', () => {
    const trades = [
      makeTrade({ pnl: -100, exitDate: '2026-01-01' }),
      makeTrade({ pnl: -200, exitDate: '2026-01-02' }),
      makeTrade({ pnl: -150, exitDate: '2026-01-03' }),
    ];
    const result = generateAdvancedStats(trades);
    // Peak never exceeds 0 so pct stays 0, but abs drawdown is tracked via abs formula
    // With all-negative: peak stays 0, drawdownAbs = 0 - cumPnl at each step
    // cumPnl: -100, -300, -450 → drawdownAbs from 0: 100, 300, 450
    expect(result.maxDrawdown.maxDrawdownAbs).toBe(450);
    expect(result.maxDrawdown.maxDrawdownPct).toBe(0); // peak was never > 0
  });

  it('current streak 3 consecutive wins', () => {
    const trades = [
      makeTrade({ pnl: -100, exitDate: '2026-01-01' }),
      makeTrade({ pnl: 100, exitDate: '2026-01-02' }),
      makeTrade({ pnl: 200, exitDate: '2026-01-03' }),
      makeTrade({ pnl: 150, exitDate: '2026-01-04' }),
    ];
    const result = generateAdvancedStats(trades);
    expect(result.currentStreak.type).toBe('W');
    expect(result.currentStreak.length).toBe(3);
  });

  it('current streak 2 consecutive losses', () => {
    const trades = [
      makeTrade({ pnl: 100, exitDate: '2026-01-01' }),
      makeTrade({ pnl: 200, exitDate: '2026-01-02' }),
      makeTrade({ pnl: -100, exitDate: '2026-01-03' }),
      makeTrade({ pnl: -150, exitDate: '2026-01-04' }),
    ];
    const result = generateAdvancedStats(trades);
    expect(result.currentStreak.type).toBe('L');
    expect(result.currentStreak.length).toBe(2);
  });

  it('longest win and lose streaks across mixed sequence', () => {
    // W W W L L W L L L L W W
    const pnls = [100, 100, 100, -50, -50, 100, -50, -50, -50, -50, 100, 100];
    const trades = pnls.map((pnl, i) =>
      makeTrade({ pnl, exitDate: `2026-01-${String(i + 1).padStart(2, '0')}` })
    );
    const result = generateAdvancedStats(trades);
    expect(result.longestWinStreak).toBe(3);
    expect(result.longestLoseStreak).toBe(4);
  });

  it('profit factor with positive and negative trades', () => {
    const trades = [
      makeTrade({ pnl: 300, exitDate: '2026-01-01' }),
      makeTrade({ pnl: 200, exitDate: '2026-01-02' }),
      makeTrade({ pnl: -100, exitDate: '2026-01-03' }),
      makeTrade({ pnl: -100, exitDate: '2026-01-04' }),
    ];
    const result = generateAdvancedStats(trades);
    // gross wins = 500, gross losses = 200 → profit factor = 2.5
    expect(result.profitFactor).toBeCloseTo(2.5, 2);
  });

  it('profit factor with no losses returns Infinity', () => {
    const trades = [
      makeTrade({ pnl: 100, exitDate: '2026-01-01' }),
      makeTrade({ pnl: 200, exitDate: '2026-01-02' }),
      makeTrade({ pnl: 150, exitDate: '2026-01-03' }),
    ];
    const result = generateAdvancedStats(trades);
    expect(result.profitFactor).toBe(Infinity);
  });

  it('kelly percentage: 60% win rate, 2:1 ratio -> 40%', () => {
    // 6 wins of +200, 4 losses of -100 → winRate=0.6, avgWin=200, avgLoss=100, ratio=2
    // Kelly = 0.6 - (0.4/2) = 0.6 - 0.2 = 0.4 = 40%
    const wins = Array.from({ length: 6 }, (_, i) =>
      makeTrade({ pnl: 200, exitDate: `2026-01-${String(i + 1).padStart(2, '0')}` })
    );
    const losses = Array.from({ length: 4 }, (_, i) =>
      makeTrade({ pnl: -100, exitDate: `2026-01-${String(i + 7).padStart(2, '0')}` })
    );
    const result = generateAdvancedStats([...wins, ...losses]);
    expect(result.kellyPct).toBeCloseTo(40, 1);
  });

  it('calmar ratio is null when no drawdown', () => {
    const trades = [
      makeTrade({ pnl: 100, exitDate: '2026-01-01' }),
      makeTrade({ pnl: 200, exitDate: '2026-01-02' }),
    ];
    const result = generateAdvancedStats(trades);
    expect(result.calmarRatio).toBeNull();
  });

  it('calmar ratio computed correctly when drawdown exists', () => {
    // cumPnl: 200, 100 → drawdown = 100, totalPnl = 100
    const trades = [
      makeTrade({ pnl: 200, exitDate: '2026-01-01' }),
      makeTrade({ pnl: -100, exitDate: '2026-01-02' }),
    ];
    const result = generateAdvancedStats(trades);
    expect(result.maxDrawdown.maxDrawdownAbs).toBe(100);
    expect(result.calmarRatio).toBeCloseTo(1.0, 2); // totalPnl=100 / drawdown=100
  });
});
