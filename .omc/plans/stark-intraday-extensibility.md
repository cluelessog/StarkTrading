# Stark-Trading: Intraday Extensibility Plan

**Created:** 2026-03-04
**Status:** v1 — Ready for Architect/Critic review
**Mode:** RALPLAN consensus (SHORT)
**Scope:** Architectural seams and decisions for Phase 1-2 that enable future intraday trading support without rewrite
**NOT in scope:** Building any intraday features now

---

## Context

The user trades both swing and intraday. Stark is currently designed for swing trading (evening/morning workflow, daily OHLCV, Minervini scoring). Five intraday capabilities are planned for the future:

1. **Intraday MBI / Breadth Pulse** — real-time breadth during market hours
2. **Pre-market Prep** — gap analysis, key levels, overnight cues
3. **Intraday Risk Guardrails** — max daily loss, consecutive loss circuit breaker, position heat
4. **Intraday Trade Journal** — entry/exit timing, hold duration, R-multiple, time-of-day analysis, setup tagging
5. **Sector Momentum Dashboard** — real-time sector rotation tracking

This plan identifies what to do NOW (Phase 1-2) to keep these doors open, and what NOT to do now to avoid over-engineering.

---

## RALPLAN-DR Summary

### Guiding Principles

1. **Seams, not features.** Add interface boundaries and schema flexibility now. Build intraday features later. A seam costs minutes; a rewrite costs weeks.
2. **Time-awareness from day one.** The single most expensive retrofit is adding temporal granularity to a system that assumed "one data point per day." Design the core data model to accommodate sub-daily resolution.
3. **Trade type as a first-class concept.** Swing and intraday trades have different risk profiles, hold durations, journal fields, and performance metrics. The `trade_journal` and `positions` tables must distinguish them from the start.
4. **MBI is already the seam for breadth.** The MBI integration plan's `MBIDataManager` with its fallback chain is the natural extension point for intraday breadth. No new architecture needed — just a higher-frequency caller.
5. **Don't build a streaming system.** Intraday does NOT require real-time WebSocket feeds for Stark's use case. Polling Angel One every 1-5 minutes during market hours is sufficient and dramatically simpler.

### Decision Drivers

1. **Schema cost of retrofitting:** Adding a `trade_type` column and timestamp precision to tables AFTER they contain production data requires migrations and backfills. Doing it now costs nothing.
2. **Interface segregation:** If the `ScoringEngine`, `MBIDataManager`, and `TradeJournal` APIs assume daily granularity in their function signatures, every intraday caller will need adapter wrappers. Generic signatures cost nothing now.
3. **Risk of over-engineering:** Building intraday infrastructure before the swing system works is the #1 project risk. The user needs the swing MVP in 7-9 weeks. Every hour spent on intraday delays that.

### Viable Options

#### Option A: Targeted Seams (RECOMMENDED)

**Approach:** Make 6 specific, low-cost changes during Phase 1-2 that create extension points for intraday. No new modules, no new tables beyond what is already planned. Changes are limited to: schema columns, TypeScript union types, interface signatures, and config structure.

**Pros:**
- Minimal effort: ~2-4 hours of additional work spread across Phase 1-2
- Zero risk of delaying the swing MVP
- Each seam is independently valuable (e.g., `trade_type` improves swing journal too)
- No speculative architecture — every change has a concrete future consumer

**Cons:**
- Does not pre-build any intraday infrastructure — Phase 5 still requires significant new code
- Some intraday features (real-time breadth polling, sector dashboard) will need new modules that cannot be "seamed" in advance
- If intraday requirements change significantly, some seams may be unused

#### Option B: Intraday Foundation Layer

**Approach:** Build a lightweight `@stark/core/intraday/` module during Phase 1-2 with stub implementations: polling scheduler, intraday session manager, real-time risk calculator. Wire them into the existing architecture but leave them disabled.

**Pros:**
- Intraday Phase 5 would be faster to start (foundation already exists)
- Forces early thinking about polling architecture and session management
- Stubs serve as living documentation of the intraday design

**Cons:**
- 1-2 weeks of additional Phase 1-2 work on code that will not be used for months
- Stubs rot: by the time Phase 5 starts, requirements may have changed and stubs become misleading
- Violates "MVP-first" principle — building infrastructure for a future that may not arrive
- Increases test surface area with no immediate value

**Invalidation rationale:** The user explicitly stated this is about keeping doors open, not building intraday now. Option B builds doors that may lead to rooms that do not exist yet. The swing MVP timeline (7-9 weeks solo) cannot absorb 1-2 weeks of speculative work.

---

## ADR: Architecture Decision Record

### Decision
Option A: Targeted Seams. Make 6 specific low-cost changes during Phase 1-2 that create extension points for future intraday support.

### Drivers
- Solo developer with a 7-9 week timeline for the swing MVP
- Schema and interface changes are nearly free now but expensive to retrofit later
- Intraday requirements are directionally known but not fully specified

### Alternatives Considered
- Option B (Intraday Foundation Layer): Rejected because it adds 1-2 weeks of speculative work to the critical path with no immediate value and high rot risk.

### Why Chosen
Option A delivers the extensibility guarantee at minimal cost. The 7 targeted seams address the highest-cost retrofits (schema, type system, interface signatures) while leaving the actual intraday implementation to Phase 5 when requirements are concrete and the swing system is proven.

### Consequences
- Phase 5 will still require significant new code (polling scheduler, intraday session, sector dashboard, risk engine)
- The seams assume intraday will use the same `@stark/core` package — if a separate service architecture is chosen later, some seams are wasted (low cost either way)
- Trade journal analytics in Phase 3 will naturally handle the `trade_type` distinction, giving early value

### Follow-ups
- After Phase 3 (journal + performance analytics), revisit intraday requirements with real swing trading data
- User should document their intraday setups/strategies as they trade, informing Phase 5 design
- If Angel One adds WebSocket support, re-evaluate polling vs streaming for Phase 5

---

## Architectural Decisions to Make NOW (Phase 1-2)

### Seam 1: Trade Type in Schema and Type System

**Where:** Phase 1, Step 1.1 (schema) + `packages/core/src/models/trade.ts`

**Change:** Add `trade_type` column to `trade_journal` and `positions` tables. Add TypeScript union type.

```sql
-- trade_journal table (already planned, add this column)
trade_type TEXT NOT NULL DEFAULT 'swing'  -- 'swing' | 'intraday'

-- positions table (already planned, add this column)
trade_type TEXT NOT NULL DEFAULT 'swing'  -- 'swing' | 'intraday'
```

```typescript
// models/trade.ts
type TradeType = 'swing' | 'intraday';

interface TradeEntry {
  // ... existing fields ...
  trade_type: TradeType;
  // Intraday-specific fields (nullable, populated only for intraday trades)
  setup_type?: string;        // e.g., 'ORB', 'VWAP_bounce', 'momentum'
  entry_time?: string;        // ISO timestamp (swing trades only need date)
  exit_time?: string;         // ISO timestamp
}
```

**Cost:** ~15 minutes. One column, one type, a few nullable fields.

**Why now:** Retrofitting `trade_type` into a journal with 50+ swing trades requires a migration and backfill. Adding it to an empty schema costs nothing.

---

### Seam 2: Timestamp Precision in OHLCV Cache

**Where:** Phase 1, Step 1.1 (schema) + `packages/core/src/cache/ohlcv-cache.ts`

**Change:** The existing `ohlcv_cache` table already stores `interval` (daily vs 75min). Ensure the cache key and query interface accept arbitrary intervals, not just 'daily' and '75min'.

```typescript
// cache/ohlcv-cache.ts
type OHLCVInterval = 'daily' | '75min' | '15min' | '5min' | '1min';

interface OHLCVCacheQuery {
  symbol: string;
  interval: OHLCVInterval;
  from: string;   // ISO date or datetime
  to: string;     // ISO date or datetime
}
```

**Cost:** ~10 minutes. The cache already handles intervals; this just widens the type.

**Why now:** If the cache API is typed as `interval: 'daily' | '75min'`, every intraday caller needs to cast or the type must be widened later (touching every call site).

---

### Seam 3: MBI Refresh Frequency in Config

**Where:** Phase 1, Step 1.1 (config schema in MBI plan)

**Change:** Add a `refresh_interval` field to MBI config. Default to `'daily'` for swing. Intraday will set it to `'5min'` or `'1min'`.

```json
{
  "mbi": {
    "em_thresholds": { "strong_bull": 25, "bull": 15, "cautious": 12, "choppy": 9.5 },
    "primary_source": "sheet",
    "universe": "NIFTY500",
    "refresh_interval": "daily"
  }
}
```

**Cost:** ~5 minutes. One config field. The `MBIDataManager.fetchMBI()` method does not need to implement polling now — it just needs to NOT hardcode "fetch once per session."

**Why now:** If `MBIDataManager` is built with the assumption "called once per evening," its internals may use patterns (eager caching, no staleness check within a session) that break when called every 5 minutes. Making refresh frequency configurable keeps the design honest.

---

### Seam 4: Risk Configuration Structure

**Where:** Phase 1, Step 1.1 (config schema) + Phase 3, Step 3.2 (portfolio heat)

**Change:** Structure the risk config to accommodate both swing and intraday risk parameters.

```json
{
  "risk": {
    "total_capital": 500000,
    "swing": {
      "max_portfolio_heat_pct": 8,
      "warn_portfolio_heat_pct": 6,
      "max_risk_per_trade_pct": 2
    },
    "intraday": {
      "max_daily_loss": 5000,
      "max_daily_loss_pct": 1,
      "consecutive_loss_circuit_breaker": 3,
      "max_open_positions": 3,
      "max_risk_per_trade_pct": 0.5
    }
  }
}
```

**Cost:** ~10 minutes. Structure the config now; only implement `risk.swing.*` in Phase 1-3. The `risk.intraday.*` section is defined but unused until Phase 5.

**Why now:** If risk config is flat (`max_heat: 8, warn_heat: 6`), adding intraday-specific limits later creates naming collisions and ambiguity. Namespacing now is trivial.

---

### Seam 5: Sector Data with Timestamps

**Where:** Phase 2, Step 2.2 (sector money flow) + `packages/core/src/models/market.ts`

**Change:** Store sector strength snapshots with full timestamps, not just dates. The intraday sector momentum dashboard will query intra-day sector rotation.

```typescript
interface SectorSnapshot {
  sector: string;
  strength: 'STRONG' | 'MODERATE' | 'WEAK';
  index_change_pct: number;
  vs_nifty_pct: number;
  captured_at: string;  // ISO datetime (not just date)
}
```

```sql
-- sector_money_flow table (already planned)
-- Ensure captured_at is DATETIME, not DATE
captured_at TEXT NOT NULL  -- ISO 8601 datetime, e.g., '2026-03-04T15:30:00+05:30'
```

**Cost:** ~5 minutes. Use datetime instead of date in one column.

**Why now:** If sector data is stored with date-only precision, intraday sector rotation tracking requires a schema migration and cannot use historical swing-era data for comparison.

---

### Seam 6: Journal Analytics Filter by Trade Type

**Where:** Phase 3, Step 3.3 (performance validation) + Step 3.4 (scoring evolution)

**Change:** All performance queries should accept an optional `trade_type` filter. This is almost free if Seam 1 is in place.

```typescript
interface PerformanceQuery {
  trade_type?: TradeType;   // undefined = all trades
  from_date?: string;
  to_date?: string;
  min_score?: number;
}
```

**Cost:** ~15 minutes. Add a WHERE clause parameter to existing queries.

**Why now:** If performance analytics are built without trade type filtering, the user cannot separate swing vs intraday win rates. Mixing them would produce misleading insights (intraday trades have fundamentally different R-multiples and hold durations).

---

### Seam 7: MBI Daily Table Composite Key (Datetime Precision)

**Where:** Phase 1, Step 1.1 (schema) — modifies MBI integration plan's `mbi_daily` table

**Change:** The MBI plan defines `mbi_daily` with `date TEXT PRIMARY KEY` (date-only). For intraday breadth polling (multiple MBI snapshots per day), this needs a composite key:

```sql
-- Change from: date TEXT PRIMARY KEY
-- Change to:
CREATE TABLE mbi_daily (
    date TEXT NOT NULL,              -- YYYY-MM-DD
    captured_at TEXT NOT NULL,       -- ISO 8601 datetime (e.g., '2026-03-04T14:30:00+05:30')
    source TEXT NOT NULL,
    -- ... rest of columns unchanged ...
    PRIMARY KEY (date, captured_at)
);
```

**Cost:** ~2 minutes. Change one line in schema definition.

**Why now:** For swing, there is exactly one row per date — behavior unchanged. For intraday (Phase 5), the breadth pulse feature needs multiple snapshots per day. A date-only primary key prevents this entirely and requires a painful migration + data backfill later. This is the cheapest seam with the highest retrofit cost if skipped.

**Cross-reference:** Update the MBI integration plan (`stark-mbi-integration.md`) schema section to use this composite key. The `MBIDataManager.fetchMBI()` method should not hardcode "if already fetched today, skip" — instead check `captured_at` freshness against `refresh_interval` from Seam 3.

---

## What NOT to Do Now

These are things that might seem prudent but would be over-engineering:

1. **Do NOT build a polling/scheduler system.** Intraday needs a "run every N minutes during market hours" scheduler. This is Phase 5 work. The swing system is user-initiated or cron. Building a polling loop now adds complexity with zero value.

2. **Do NOT add WebSocket support.** Angel One Smart API supports WebSocket for live quotes. This is tempting but unnecessary — polling every 1-5 minutes is sufficient for Stark's use case (scoring, not execution). WebSocket adds connection management, reconnection logic, and heartbeat handling.

3. **Do NOT build an intraday scoring engine.** Intraday trades use different setups (ORB, VWAP bounce, momentum) than swing (Minervini scoring). The scoring engine's Factor Registry pattern is extensible enough — intraday factors can be registered later. Do not pre-define them.

4. **Do NOT add real-time P&L tracking.** The swing journal logs entry/exit as discrete events. Real-time "position heat" with live price updates is an intraday feature. The `positions` table supports it structurally (Seam 1), but the live update loop is Phase 5.

5. **Do NOT build a sector rotation dashboard.** The sector money flow data (Seam 5) stores snapshots with timestamps. The dashboard that renders rotation across intraday snapshots is a UI feature for Phase 5.

6. **Do NOT add `market_hours` session management.** Detecting "is the market open right now" and gating intraday features accordingly is Phase 5 logic. The config can hold market hours (`09:15-15:30 IST`) but no code should consume it yet.

---

## Interface Boundaries for Intraday (Phase 5)

These are the extension points where intraday features will plug in:

### 1. MBIDataManager — Breadth Pulse

```
Current (swing):  MBIDataManager.fetchMBI() called once per evening
Future (intraday): MBIDataManager.fetchMBI() called every N minutes via a scheduler
                   Same fallback chain, same storage, higher frequency
                   New: MBIDataManager.getLatestIntraday() for quick reads from cache
```

The MBI plan's three-tier fallback (Sheet -> Chartink -> Angel One) works for intraday too. The Sheet updates during market hours. No new architecture needed.

### 2. TradeJournal — Intraday Entries

```
Current (swing):  journal.logEntry({ symbol, entry_price, score_breakdown, ... })
Future (intraday): journal.logEntry({ symbol, entry_price, trade_type: 'intraday',
                     setup_type: 'ORB', entry_time: '09:22:00', ... })
                   Same table, same method, additional fields populated
```

### 3. RiskManager — Intraday Guardrails

```
Current (swing):  riskManager.checkPortfolioHeat() — total risk across open positions
Future (intraday): riskManager.checkDailyLoss() — sum of closed intraday P&L today
                   riskManager.checkConsecutiveLosses() — circuit breaker
                   riskManager.checkPositionLimit() — max concurrent intraday positions
                   New methods on existing RiskManager, reading from config.risk.intraday
```

### 4. SectorMoneyFlow — Real-Time Rotation

```
Current (swing):  sectorFlow.getSnapshot() — one snapshot per day
Future (intraday): sectorFlow.getSnapshot() — same method, called more frequently
                   sectorFlow.getRotation(from, to) — new method, queries timestamped snapshots
                   Seam 5 (datetime precision) enables this query
```

### 5. OHLCVCache — Intraday Candles

```
Current (swing):  cache.get({ symbol, interval: 'daily', ... })
Future (intraday): cache.get({ symbol, interval: '5min', ... })
                   Same cache, same API, different interval parameter
                   Seam 2 (widened interval type) enables this
```

---

## Future Phase 5: Intraday Trading (Outline)

**Prerequisites:** Phase 1-3 complete, swing system proven with 20+ trades.

### Step 5.1: Market Session Manager
- Detect Indian market hours (09:15-15:30 IST, pre-market 09:00-09:15)
- `isMarketOpen()`, `timeToClose()`, `currentSession()` utilities
- Config: `market_hours`, `pre_market_start`, `holidays` (NSE holiday calendar)

### Step 5.2: Intraday Polling Scheduler
- Simple interval-based loop: every N minutes during market hours
- Fetch: OHLCV (5min candles), MBI/breadth, sector snapshots
- Store all fetched data through existing cache/storage layers
- CLI: `stark intraday start` / `stark intraday stop`

### Step 5.3: Pre-Market Prep
- Gap analysis: compare previous close to pre-market indicative price
- Key levels: previous day high/low, VWAP, pivot points
- Overnight cues: news summaries (existing Perplexity/News API integration)
- CLI: `stark premarket`

### Step 5.4: Intraday Risk Engine
- Read `config.risk.intraday.*` settings (defined in Seam 4)
- Max daily loss tracking: sum of closed intraday P&L today
- Consecutive loss circuit breaker: N losses in a row -> hard stop
- Position limit enforcement: max N concurrent intraday positions
- Real-time position heat: current unrealized P&L across open intraday positions
- CLI: `stark risk` (intraday risk dashboard)

### Step 5.5: Intraday Trade Journal Extensions
- Setup type tagging: ORB, VWAP bounce, momentum, pullback, etc.
- Entry/exit time tracking with second precision
- Hold duration calculation
- Time-of-day analysis: win rate by hour (09:15-10:00 vs 14:00-15:00)
- R-multiple with intraday-specific risk (tighter stops)

### Step 5.6: Sector Momentum Dashboard
- Query timestamped sector snapshots (Seam 5) for intra-day rotation
- Identify: sectors gaining/losing momentum relative to Nifty
- Highlight: sector rotation events (money flowing from X to Y)
- CLI: `stark sectors --live` (during market hours)

### Step 5.7: Intraday Performance Analytics
- Filter all Phase 3 analytics by `trade_type = 'intraday'` (Seam 6)
- Additional intraday-specific metrics:
  - Win rate by time of day
  - Win rate by setup type
  - Average hold duration for winners vs losers
  - Best/worst trading hours
  - Daily P&L distribution

---

## Summary of Changes to Phase 1-3

| Seam | Where | Change | Cost |
|------|-------|--------|------|
| 1. Trade Type | Phase 1 schema + models | `trade_type` column + TypeScript union + nullable intraday fields | 15 min |
| 2. OHLCV Intervals | Phase 1 cache types | Widen `OHLCVInterval` union type | 10 min |
| 3. MBI Refresh | Phase 1 config | Add `refresh_interval` to MBI config | 5 min |
| 4. Risk Config | Phase 1 config | Namespace risk params under `swing`/`intraday` | 10 min |
| 5. Sector Timestamps | Phase 2 sector schema | Use datetime instead of date in `captured_at` | 5 min |
| 6. Analytics Filter | Phase 3 queries | Add `trade_type` filter to performance queries | 15 min |
| 7. MBI Composite Key | Phase 1 schema | Change `mbi_daily` PK from date-only to `(date, captured_at)` | 2 min |

**Total additional effort: ~1 hour spread across Phase 1-3.**

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation | Status |
|------|-----------|--------|------------|--------|
| Intraday requirements change significantly by Phase 5 | MEDIUM | LOW | Seams are cheap (1 hour total). Even if wasted, the cost is negligible. Schema columns are harmless. | ACCEPTED |
| Angel One rate limits block intraday polling | HIGH | HIGH | Phase 5 design uses polling (not streaming). OHLCV cache prevents redundant fetches. 1-5 min interval is light. Stale data fallback exists. | MITIGATED (Phase 5) |
| Intraday and swing analytics get mixed | MEDIUM | MEDIUM | Seam 1 (`trade_type`) and Seam 6 (filter) prevent this by design. | MITIGATED |
| Over-engineering: seams create maintenance burden | LOW | LOW | All 7 seams are additive (new columns, wider types, config sections). They do not change existing behavior. | ACCEPTED |

---

## Success Criteria

1. All 7 seams are implemented during Phase 1-3 with no delay to the swing MVP timeline
2. The `trade_journal` table can store both swing and intraday trades from day one
3. The OHLCV cache can store sub-daily candles without schema changes
4. MBI refresh frequency is configurable, not hardcoded
5. Risk configuration is namespaced for swing/intraday without ambiguity
6. Performance analytics can filter by trade type
7. No intraday-specific code exists in the codebase (no over-engineering)
