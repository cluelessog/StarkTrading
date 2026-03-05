export type WatchlistPriority = 0 | 1 | 2 | 3;

export interface SymbolInfo {
  symbol: string;
  token: string;
  name: string;
  exchange: string;
  segment: string;
  instrumentType: string;
}

export interface Stock {
  symbol: string;
  token: string;
  name: string;
  sector?: string;
  listingDate?: string;
}

export interface WatchlistStock {
  id?: number;
  watchlistId: number;
  symbol: string;
  token: string;
  name: string;
  priority: WatchlistPriority;
  addedAt: string;
}
