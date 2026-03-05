import { previousTradingDay, isTradingDay } from '../utils/trading-calendar.js';
import type { OHLCVBar } from '../models/intervals.js';

// Queries interface — only the methods we need; actual implementation provided at runtime
interface OHLCVQueries {
  getOHLCV(symbol: string, interval: string, from: string, to: string): OHLCVBar[] | Promise<OHLCVBar[]>;
  upsertOHLCV(symbol: string, interval: string, bars: OHLCVBar[]): void | Promise<void>;
  getOHLCVMeta(symbol: string, interval: string): OHLCVMeta | undefined | Promise<OHLCVMeta | undefined>;
}

interface OHLCVMeta {
  fetchedAt: string;
}

function todayIST(): string {
  // Returns YYYY-MM-DD in IST (UTC+5:30)
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  const ist = new Date(now.getTime() + istOffset);
  const y = ist.getUTCFullYear();
  const m = String(ist.getUTCMonth() + 1).padStart(2, '0');
  const d = String(ist.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function marketCloseIST(date: string): Date {
  // Returns a Date representing 15:30 IST on the given date
  // 15:30 IST = 10:00 UTC
  return new Date(`${date}T10:00:00.000Z`);
}

export class OHLCVCache {
  constructor(private queries: OHLCVQueries) {}

  async get(
    symbol: string,
    interval: string,
    from: string,
    to: string,
  ): Promise<{ bars: OHLCVBar[]; freshness: 'fresh' | 'stale' }> {
    const rows = await this.queries.getOHLCV(symbol, interval, from, to);
    const meta = await this.queries.getOHLCVMeta(symbol, interval);

    const bars: OHLCVBar[] = rows.map((r) => ({ ...r }));

    const freshness: 'fresh' | 'stale' =
      meta && this.isFresh(meta.fetchedAt) ? 'fresh' : 'stale';

    return { bars, freshness };
  }

  async set(symbol: string, interval: string, bars: OHLCVBar[]): Promise<void> {
    await this.queries.upsertOHLCV(symbol, interval, bars);
  }

  isFresh(fetchedAt: string): boolean {
    const today = todayIST();
    const referenceDay = isTradingDay(today) ? today : previousTradingDay(today);
    const closeTime = marketCloseIST(referenceDay);
    const fetchedDate = new Date(fetchedAt);
    return fetchedDate >= closeTime;
  }

  async invalidate(symbol: string, interval?: string): Promise<void> {
    // Invalidation is handled by the queries layer; we just signal via upsert with empty array
    // If interval is specified, invalidate only that interval; otherwise all intervals
    // The actual implementation depends on the db queries layer.
    // We call upsertOHLCV with an empty array to trigger a meta reset if the queries layer supports it.
    // For now this is a no-op stub that callers can override by passing a queries implementation
    // that responds to an empty bars array as an invalidation signal.
    if (interval !== undefined) {
      await this.queries.upsertOHLCV(symbol, interval, []);
    }
    // If no interval, nothing we can do without knowing all intervals; leave for queries layer
  }
}
