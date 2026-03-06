import type { DatabaseAdapter } from '../db/adapter.js';
import { Queries, type TradeJournalEntry, type InsertTradeData, type CloseTradeData } from '../db/queries.js';

export interface EntryInput {
  symbol: string;
  entryPrice: number;
  shares: number;
  stopPrice: number;
  conviction: 'HIGH' | 'MEDIUM' | 'LOW';
  tradeType?: 'swing' | 'intraday';
  sectorAtEntry?: string;
}

export interface EntryResult {
  tradeId: number;
  symbol: string;
  entryPrice: number;
  shares: number;
  stopPrice: number;
  riskAmount: number;
  scoreAtEntry: number | null;
  regime: string | null;
  conviction: string;
}

export interface ExitInput {
  symbol: string;
  exitPrice: number;
  exitReason: 'STOPPED' | 'TARGET' | 'DISCRETION' | 'INVALIDATED';
}

export interface ExitResult {
  tradeId: number;
  symbol: string;
  entryPrice: number;
  exitPrice: number;
  shares: number;
  pnl: number;
  rMultiple: number;
  holdDays: number;
  exitReason: string;
}

export class TradeManager {
  private queries: Queries;

  constructor(private db: DatabaseAdapter) {
    this.queries = new Queries(db);
  }

  entry(input: EntryInput): EntryResult {
    // Check for existing open trade
    const existing = this.queries.getOpenTradeForSymbol(input.symbol);
    if (existing) {
      throw new Error(`Already have open trade for ${input.symbol} (id=${existing.id})`);
    }

    // Auto-fill from latest score
    const latestScore = this.queries.getLatestScoreForSymbol(input.symbol);
    const latestMBI = this.queries.getLatestMBI();

    const riskPerShare = input.entryPrice - input.stopPrice;
    const riskAmount = riskPerShare * input.shares;

    const data: InsertTradeData = {
      symbol: input.symbol,
      tradeType: input.tradeType ?? 'swing',
      entryDate: new Date().toISOString().slice(0, 10),
      entryPrice: input.entryPrice,
      shares: input.shares,
      stopPrice: input.stopPrice,
      riskAmount,
      scoreAtEntry: latestScore?.breakdown?.totalScore,
      scoreBreakdownJson: latestScore ? JSON.stringify(latestScore.breakdown) : undefined,
      marketRegimeAtEntry: latestMBI?.em != null ? undefined : undefined,
      sectorAtEntry: input.sectorAtEntry,
      conviction: input.conviction,
      overrideCount: latestScore?.overrideCount ?? 0,
    };

    // Get regime from MBI if available
    if (latestMBI) {
      data.marketRegimeAtEntry = this.queries.getSetting('last_regime') ?? undefined;
    }

    const tradeId = this.queries.insertTradeEntry(data);

    return {
      tradeId,
      symbol: input.symbol,
      entryPrice: input.entryPrice,
      shares: input.shares,
      stopPrice: input.stopPrice,
      riskAmount,
      scoreAtEntry: latestScore?.breakdown?.totalScore ?? null,
      regime: data.marketRegimeAtEntry ?? null,
      conviction: input.conviction,
    };
  }

  exit(input: ExitInput): ExitResult {
    const trade = this.queries.getOpenTradeForSymbol(input.symbol);
    if (!trade) {
      throw new Error(`No open trade found for ${input.symbol}`);
    }

    const pnl = (input.exitPrice - trade.entryPrice) * trade.shares;
    const riskPerShare = trade.entryPrice - (trade.stopPrice ?? trade.entryPrice);
    const rMultiple = riskPerShare !== 0
      ? (input.exitPrice - trade.entryPrice) / riskPerShare
      : 0;

    const entryDate = new Date(trade.entryDate);
    const exitDate = new Date();
    const holdDays = Math.max(1, Math.ceil(
      (exitDate.getTime() - entryDate.getTime()) / (1000 * 60 * 60 * 24)
    ));

    const exitData: CloseTradeData = {
      exitDate: exitDate.toISOString().slice(0, 10),
      exitPrice: input.exitPrice,
      exitReason: input.exitReason,
      pnl,
      rMultiple: Math.round(rMultiple * 100) / 100,
      holdDays,
    };

    this.queries.closeTradeEntry(trade.id, exitData);

    return {
      tradeId: trade.id,
      symbol: trade.symbol,
      entryPrice: trade.entryPrice,
      exitPrice: input.exitPrice,
      shares: trade.shares,
      pnl: Math.round(pnl * 100) / 100,
      rMultiple: Math.round(rMultiple * 100) / 100,
      holdDays,
      exitReason: input.exitReason,
    };
  }

  getOpenTrades(): TradeJournalEntry[] {
    return this.queries.getOpenTrades();
  }

  getClosedTrades(): TradeJournalEntry[] {
    return this.queries.getClosedTrades();
  }

  getAllTrades(): TradeJournalEntry[] {
    return this.queries.getAllTrades();
  }
}
