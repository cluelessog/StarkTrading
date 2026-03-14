import { describe, it, expect } from 'bun:test';
import type { TradeType } from '../src/models/trade.js';
import type { OHLCVInterval } from '../src/models/intervals.js';
import type { SectorFlow } from '../src/models/market.js';
import type { StarkModelConfig } from '../src/models/config.js';
import { MIGRATIONS } from '../src/db/schema.js';

const schema = MIGRATIONS[0].sql;

describe('Intraday seams verification', () => {
  it('Seam 1: trade_journal and positions have trade_type column', () => {
    expect(schema).toContain("trade_type TEXT NOT NULL DEFAULT 'swing' CHECK (trade_type IN ('swing', 'intraday'))");
  });

  it('Seam 2: OHLCVInterval includes sub-daily intervals', () => {
    const intervals: OHLCVInterval[] = ['1m', '5m', '15m', '75m'];
    expect(intervals).toHaveLength(4);
    // Type-level check — if this compiles, the seam exists
    const minute: OHLCVInterval = '1m';
    expect(minute).toBe('1m');
  });

  it('Seam 3: StarkModelConfig.mbi has refreshInterval field', () => {
    // Type-level check — if this compiles, the seam exists
    const cfg = { refreshInterval: 5 } as Pick<StarkModelConfig['mbi'], 'refreshInterval'>;
    expect(cfg.refreshInterval).toBe(5);
  });

  it('Seam 4: RiskConfig has swing and intraday profiles', () => {
    // Type-level check — if this compiles, the seam exists
    type HasSwing = StarkModelConfig['risk']['swing'];
    type HasIntraday = StarkModelConfig['risk']['intraday'];
    const swing: HasSwing = { riskPerTrade: 10000, totalCapital: 500000, heatWarning: 0.06, heatAlert: 0.08 };
    const intraday: HasIntraday = { riskPerTrade: 5000, totalCapital: 500000, heatWarning: 0.04, heatAlert: 0.06 };
    expect(swing.riskPerTrade).toBe(10000);
    expect(intraday.riskPerTrade).toBe(5000);
  });

  it('Seam 5: sector_money_flow.captured_at uses datetime default', () => {
    expect(schema).toContain("captured_at TEXT NOT NULL DEFAULT (datetime('now'))");
    // Type-level: SectorFlow.capturedAt can hold ISO datetime
    const sf: SectorFlow = {
      sector: 'NIFTYBANK',
      strength: 'STRONG',
      indexChange: 1.5,
      vsNiftyChange: 0.5,
      capturedAt: '2026-03-12T14:30:00+05:30',
    };
    expect(sf.capturedAt).toContain('T');
  });

  it('Seam 6: TradeType includes intraday variant', () => {
    // Type-level check — intraday is a valid TradeType
    const t: TradeType = 'intraday';
    expect(t).toBe('intraday');
    const s: TradeType = 'swing';
    expect(s).toBe('swing');
  });

  it('Seam 7: mbi_daily has composite PRIMARY KEY (date, captured_at)', () => {
    expect(schema).toContain('PRIMARY KEY (date, captured_at)');
  });
});
