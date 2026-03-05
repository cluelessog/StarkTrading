import type { MBIRegime } from './market.js';

export type TradeType = 'swing' | 'intraday';

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
