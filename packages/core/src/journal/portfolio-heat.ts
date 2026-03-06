import type { DatabaseAdapter } from '../db/adapter.js';
import { Queries, type TradeJournalEntry } from '../db/queries.js';
import type { RiskProfile } from '../config/index.js';

export interface HeatPosition {
  symbol: string;
  entryPrice: number;
  shares: number;
  stopPrice: number;
  riskAmount: number;
  pctOfCapital: number;
}

export interface PortfolioHeat {
  totalRisk: number;
  totalCapital: number;
  heatPct: number;
  warningLevel: number;
  alertLevel: number;
  status: 'OK' | 'WARNING' | 'ALERT';
  positions: HeatPosition[];
}

export function calculatePortfolioHeat(
  db: DatabaseAdapter,
  riskProfile: RiskProfile,
): PortfolioHeat {
  const queries = new Queries(db);
  const openTrades = queries.getOpenTrades();

  const positions: HeatPosition[] = openTrades.map((t: TradeJournalEntry) => {
    const risk = t.riskAmount ?? ((t.entryPrice - (t.stopPrice ?? t.entryPrice)) * t.shares);
    return {
      symbol: t.symbol,
      entryPrice: t.entryPrice,
      shares: t.shares,
      stopPrice: t.stopPrice ?? t.entryPrice,
      riskAmount: Math.abs(risk),
      pctOfCapital: Math.abs(risk) / riskProfile.totalCapital * 100,
    };
  });

  const totalRisk = positions.reduce((sum, p) => sum + p.riskAmount, 0);
  const heatPct = totalRisk / riskProfile.totalCapital;

  let status: 'OK' | 'WARNING' | 'ALERT' = 'OK';
  if (heatPct >= riskProfile.heatAlert) {
    status = 'ALERT';
  } else if (heatPct >= riskProfile.heatWarning) {
    status = 'WARNING';
  }

  return {
    totalRisk: Math.round(totalRisk),
    totalCapital: riskProfile.totalCapital,
    heatPct: Math.round(heatPct * 10000) / 100,
    warningLevel: riskProfile.heatWarning * 100,
    alertLevel: riskProfile.heatAlert * 100,
    status,
    positions,
  };
}
