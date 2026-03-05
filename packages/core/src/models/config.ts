import type { EMThresholds } from './market.js';

export interface RiskConfig {
  riskPerTrade: number;      // Default: 10000 (Rs)
  totalCapital: number;      // Default: 500000 (Rs)
  heatWarning: number;       // Default: 0.06 (6%)
  heatAlert: number;         // Default: 0.08 (8%)
}

export interface StarkModelConfig {
  angelOne: {
    apiKey?: string;
    clientId?: string;
  };
  llm: {
    geminiKey?: string;
    perplexityKey?: string;
    enabled: boolean;
    cacheResponses: boolean;
    cacheTtlHours: number;
  };
  mbi: {
    emThresholds: EMThresholds;
    primarySource: 'sheet' | 'chartink';
    universe: 'NIFTY50' | 'NIFTY500';
    sheetId: string;
    sheetGid: string;
    refreshInterval?: number;  // intraday seam 3
  };
  risk: {
    swing: RiskConfig;
    intraday: RiskConfig;     // intraday seam 4
  };
  nseHolidays: string[];     // ISO date strings
  scoring: {
    scoreThresholds: { bull: number; cautious: number; choppy: number; bear: number };
    maxFocusStocks: { strongBull: number; bull: number; cautious: number; choppy: number; bear: number };
  };
}
