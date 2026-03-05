export type OHLCVInterval = '1m' | '5m' | '15m' | '75m' | '1d' | '1w' | '1M';

export interface OHLCVBar {
  timestamp: string;  // ISO date or datetime
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}
