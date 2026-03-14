import type { MBIRegime } from './market.js';

export type TradeType = 'swing' | 'intraday';
// TODO(intraday-seam-6): When building Phase 3 performance analytics,
// all queries should accept optional trade_type filter to separate swing vs intraday metrics.

export type Conviction = 'HIGH' | 'MEDIUM' | 'LOW';

export type ExitReason = 'STOPPED' | 'TARGET' | 'DISCRETION' | 'INVALIDATED';

export interface TradeEntry {
  id?: number;
  symbol: string;
  tradeType: TradeType;
  entryDate: string;
  entryPrice: number;
  shares: number;
  stopPrice: number;
  riskAmount: number;
  scoreAtEntry: number;
  scoreBreakdownJson: string;
  marketRegimeAtEntry: MBIRegime;
  sectorAtEntry?: string;
  conviction: Conviction;
  overrideCount: number;
  status: 'OPEN' | 'CLOSED';
  createdAt: string;
}

export interface TradeExit {
  tradeId: number;
  exitDate: string;
  exitPrice: number;
  exitReason: ExitReason;
  pnl: number;
  rMultiple: number;
  holdDays: number;
}

export interface Position {
  id?: number;
  symbol: string;
  tradeType: TradeType;
  entryDate: string;
  entryPrice: number;
  shares: number;
  stopPrice: number;
  riskAmount: number;
  status: 'OPEN' | 'CLOSED';
}
