import type { FactorInput, FactorOutput } from '../registry.js';

/**
 * IPO Recency: listed within last 2 years.
 * Checks instrument master listing date if available.
 * Fallback: uses earliest OHLCV bar as proxy for listing date.
 */
export async function ipoRecency(input: FactorInput): Promise<FactorOutput> {
  const { symbol, provider, dailyBars } = input;

  const TWO_YEARS_MS = 2 * 365.25 * 24 * 60 * 60 * 1000;
  const now = Date.now();

  // Try instrument master for listing date
  try {
    const instruments = await provider.getInstrumentMaster('NSE');
    const inst = instruments.find(
      (i) => i.symbol === symbol || i.token === input.token,
    );

    if (inst?.listingDate) {
      const listingTime = new Date(inst.listingDate).getTime();
      const age = now - listingTime;

      if (age <= TWO_YEARS_MS) {
        return {
          score: 1,
          reasoning: `Listed ${inst.listingDate} (${(age / (365.25 * 24 * 60 * 60 * 1000)).toFixed(1)} years ago)`,
          dataSource: 'instrument_master',
          metadata: { listingDate: inst.listingDate },
        };
      }

      return {
        score: 0,
        reasoning: `Listed ${inst.listingDate} (>${(age / (365.25 * 24 * 60 * 60 * 1000)).toFixed(1)} years ago)`,
        dataSource: 'instrument_master',
        metadata: { listingDate: inst.listingDate },
      };
    }
  } catch {
    // Fallback to OHLCV data
  }

  // Fallback: use earliest bar as proxy
  if (dailyBars.length > 0) {
    const earliest = new Date(dailyBars[0].timestamp).getTime();
    const age = now - earliest;

    // If we have less than 2 years of data, it might be a recent IPO
    if (age <= TWO_YEARS_MS && dailyBars.length < 400) {
      return {
        score: 1,
        reasoning: `Data starts ${dailyBars[0].timestamp} — likely recent listing`,
        dataSource: 'ohlcv_cache_proxy',
        metadata: { earliestBar: dailyBars[0].timestamp, barCount: dailyBars.length },
      };
    }
  }

  return {
    score: 0,
    reasoning: 'Not a recent IPO (>2 years or insufficient data)',
    dataSource: 'ohlcv_cache_proxy',
  };
}
