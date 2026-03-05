export type MBIRegime = 'STRONG_BULL' | 'BULL' | 'CAUTIOUS' | 'CHOPPY' | 'BEAR';

export type MBISource = 'sheet' | 'chartink' | 'breadth_only' | 'stale_cache';

export interface EMThresholds {
  strongBull: number;  // default: 25
  bull: number;        // default: 15
  cautious: number;    // default: 12
  choppy: number;      // default: 9.5
}

export interface MBIData {
  date: string;
  capturedAt: string;
  source: MBISource;
  em: number | null;
  pct52WH: number;
  pct52WL: number;
  ratio4_5: number;
  pctAbove20SMA?: number;
  pctAbove50SMA?: number;
  pctAbove200SMA?: number;
  pctBelow200SMA?: number;
  f10?: number;
  f20?: number;
  f50?: number;
  rawSourceJson?: string;
  fetchedAt: string;
  dataFreshness: 'fresh' | 'stale';
}

export interface BreadthData {
  pct52WH: number;
  pct52WL: number;
  pctAbove50SMA: number;
  pctAbove200SMA: number;
  pctAbove20SMA?: number;
  ratio4_5?: number;
}

export interface MarketContext {
  id?: number;
  date: string;
  niftyClose: number;
  nifty50DMA: number;
  nifty200DMA: number;
  mbiRegime?: MBIRegime;
  mbiEm?: number | null;
  mbiSource?: MBISource;
  createdAt: string;
}

export type SectorStrength = 'STRONG' | 'MODERATE' | 'WEAK';

export interface SectorFlow {
  sector: string;
  strength: SectorStrength;
  indexChange: number;
  vsNiftyChange: number;
  capturedAt: string;
}
