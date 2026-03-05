# Stark-Trading: Market Breadth Indicator (MBI) Integration Plan

**Created:** 2026-03-04
**Status:** v5.1 — Corrected data sources: EM comes from Google Sheet (gviz CSV endpoint), NOT Chartink. Chartink provides raw breadth only. Sheet is primary source for all MBI data including EM. Three-tier fallback: Sheet → Chartink (raw breadth) → Angel One (self-calculated breadth). v5.1: fixed v4 artifacts (config default, labels, field name), added Sheet response validation, added breadth-only downgrade test, added non-linear regression models.
**Mode:** DELIBERATE (market context drives all trading decisions; incorrect signals = real money risk)
**Depends on:** `dexter-trading-implementation.md` v5 (Phase 2, Step 2.2)

---

## RALPLAN-DR Summary

### Guiding Principles

1. **MBI replaces the naive regime classifier, not supplements it.** The existing plan's Nifty-vs-MA + "breadth %" approach is a placeholder with no defined data source. MBI provides a battle-tested, multi-dimensional breadth system that subsumes it entirely.
2. **Automate what the user does manually today.** The user reads MBI data (including EM) from a Google Sheet that is maintained by a third party who populates it from Chartink. Stark should fetch this data directly from the Sheet via the gviz CSV endpoint as part of the evening workflow with zero manual steps.
3. **EM is the north star metric.** Easy Money (EM) drives all trading gating decisions. It measures follow-through in the market — how easily money is being made. The 52WH/52WL and 4.5r are secondary confirmation signals. This priority hierarchy (EM > 52WHL > 4.5r) must be reflected in code and UI.
4. **Graceful degradation with three-tier fallback.** The Sheet may go down or the maintainer may stop updating. Chartink scraping may break. When both are unavailable, Stark falls back to self-calculated raw breadth from Angel One OHLCV for a simplified regime classification — without EM, since the formula is proprietary.
5. **EM is proprietary — don't fabricate it.** The EM (Easy Money) formula is proprietary (Stocksgeeks / Finally Nitin). It measures follow-through in the market. The Sheet maintainer computes it from raw Chartink data. In v1, EM comes exclusively from the Google Sheet. When the Sheet is unavailable, the fallback classifier uses raw breadth signals directly (no EM). Future: reverse-engineer EM via regression analysis after collecting sufficient parallel data (Sheet EM alongside raw breadth inputs).

### Decision Drivers

1. **Data acquisition reliability:** The Google Sheet (gviz CSV endpoint) is the most reliable source — no scraping, no auth, just an HTTP GET. Chartink has no official API and scraping is fragile. Angel One covers ~5000 NSE stocks but calculating breadth is API-intensive. The three-tier fallback (Sheet → Chartink → Angel One) is the key architectural decision.
2. **EM formula opacity:** EM (Easy Money) measures market follow-through. The exact formula is proprietary (Stocksgeeks / "Finally Nitin"). The Sheet maintainer computes EM from raw Chartink data. We get the pre-computed EM from the Sheet. When the Sheet is unavailable, we cannot compute EM — we must classify regime using raw breadth metrics alone.
3. **Scope creep risk:** Full MBI has 24 columns. Mini MBI has 5. The user is a swing trader. Over-implementing breadth analysis delays the core scoring engine which has zero code today.

### Viable Options

#### Option A: Sheet-First with Chartink + Self-Calculated Fallback (RECOMMENDED)

**Approach:** Fetch all MBI data (including pre-computed EM) from the Google Sheet via the `gviz/tq?tqx=out:csv` endpoint (no auth needed). When the Sheet is unavailable, fall back to Chartink scraping for raw breadth metrics (no EM). When Chartink is also unavailable, fall back to self-calculated breadth from Angel One OHLCV data.

**Pros:**
- Gets the exact EM value the user already trusts — same data they read manually today
- Sheet provides all MBI columns including EM in one HTTP GET (no scraping, no auth)
- Three-tier fallback ensures Stark never shows "no market data"
- Simplest primary path — just a CSV fetch, no HTML parsing
- The gviz endpoint has been tested and works with this specific sheet

**Cons:**
- Sheet is maintained by a third party — if they stop updating or change structure, primary source breaks
- gviz endpoint is undocumented Google infrastructure — could change or be restricted
- EM is only available from the Sheet; Chartink and self-calculated fallbacks have no EM
- Three code paths to maintain (Sheet CSV + Chartink scraper + Angel One breadth)

#### Option B: Self-Calculated Only (No External Dependencies)

**Approach:** Calculate all breadth metrics from Angel One OHLCV data. Fetch daily data for NIFTY 500 constituents, compute SMA crossovers, 52W highs/lows. Classify regime using raw breadth metrics without EM (since the formula is proprietary and unknown).

**Pros:**
- No external dependency — fully self-contained
- Single code path, easier to maintain
- Full control over calculation methodology

**Cons:**
- Requires fetching OHLCV for ~500 stocks daily (API-intensive, ~8-10 minutes at 1 req/sec)
- No EM value at all — loses the north star metric the user's entire trading system is built around
- Regime classification uses raw breadth thresholds which the user has NOT calibrated their intuition around
- 52WH/52WL detection requires maintaining a 52-week price history cache
- More engineering effort upfront (calculate all SMA crossover percentages)

#### Option C: Google Sheets OAuth API (REJECTED)

**Approach:** Read MBI data via the official Google Sheets API with OAuth authentication.

**Why rejected:**
- Adds Google OAuth dependency to a local-first CLI tool (violates Principle 3 of the main plan)
- The gviz CSV endpoint achieves the same result without auth — OAuth is unnecessary overhead
- More complex setup for no additional benefit over the gviz approach

---

## Architecture Decision Record (ADR)

### Decision
Option A: Sheet-First with Chartink + Self-Calculated Fallback.

### Drivers
- User already trusts the Sheet's EM values and has calibrated their trading thresholds around them
- Sheet provides all MBI data including EM in a single HTTP GET via gviz CSV endpoint (no auth, no scraping)
- Three-tier fallback (Sheet → Chartink → Angel One) ensures the system degrades gracefully

### Alternatives Considered
- Option B (self-calculated only) loses EM entirely — the user's north star metric
- Option C (Google Sheets OAuth API) adds unnecessary auth complexity when gviz endpoint works without it

### Why Chosen
The user's existing workflow centers on the Google Sheet data. The gviz CSV endpoint provides the exact same data programmatically with zero auth overhead. The Sheet is the ONLY source of EM (proprietary formula computed by the Sheet maintainer from Chartink data). Chartink scraping provides raw breadth metrics as a secondary fallback, and Angel One self-calculated breadth as a tertiary fallback.

### Consequences
- Depends on Google's undocumented gviz endpoint remaining available
- Depends on the Sheet maintainer continuing to update the sheet
- When the Sheet is down, no EM is available — fallback uses raw breadth metrics for coarser regime classification
- Must clearly label in the UI when using "breadth-only fallback" vs "EM-based" classification
- The `market_context` DB schema must accommodate all three data sources

### Follow-ups
- Collect parallel data: store Sheet EM alongside raw breadth inputs daily in `mbi_daily` table
- After 30+ days of parallel data, attempt regression analysis to reverse-engineer EM formula from raw inputs
- If reverse-engineering succeeds, add self-calculated EM as a proper fallback (promoting breadth-only to EM-capable)
- If Sheet becomes permanently unavailable, the breadth-only fallback provides basic regime classification until EM formula is reverse-engineered

---

## Pre-Mortem (Deliberate Mode)

### Failure Scenario 1: Google Sheet Becomes Unavailable
**Trigger:** The Sheet maintainer stops updating, Google restricts the gviz endpoint, or the sheet is deleted/restructured.
**Impact:** Primary data source (and only EM source) gone. System falls back to Chartink raw breadth → Angel One breadth-only.
**Mitigation:** (a) Build the breadth-only fallback classifier FIRST (Step 2) so the system is never without market context. (b) Store every Sheet EM value alongside raw breadth inputs from day one — this parallel data enables future regression analysis to reverse-engineer EM. (c) Monitor Sheet freshness: if the last EM update is >2 days old, warn user. (d) Chartink scraping provides raw breadth metrics as secondary source even without EM.

### Failure Scenario 2: Breadth-Only Fallback Produces Different Regime Than EM Would
**Trigger:** Sheet is down. Raw breadth metrics (52WH%, 52WL%, SMA%) suggest BULL but EM would have said CAUTIOUS (or vice versa), because EM captures follow-through dynamics that raw breadth alone cannot.
**Impact:** User in fallback mode gets a less accurate regime classification. Could overtrade in weak conditions or miss opportunities in strong ones.
**Mitigation:** (a) The breadth-only classifier uses conservative thresholds — biased toward caution when EM is unavailable. (b) Display a clear "Breadth-only mode (no EM)" warning so the user knows to cross-check against their Sheet manually. (c) Collect parallel data for future EM reverse-engineering. (d) After 30+ days of parallel data, if regression succeeds (R² > 0.85), promote derived EM to fallback mode.

### Failure Scenario 3: Angel One Rate Limits Block Breadth Calculation
**Trigger:** Fetching OHLCV for 500 stocks at 1 req/sec = ~8 minutes. Angel One throttles or the user's token expires mid-batch.
**Impact:** Tertiary fallback (self-calculated breadth) cannot complete. If Sheet and Chartink are also down, no breadth data at all.
**Mitigation:** Cache breadth data aggressively (it only changes once per trading day). If breadth fetch fails partway, use yesterday's cached values with a "stale" flag. Prioritize NIFTY 50 constituents first (sufficient for basic regime), then NIFTY 500 for full breadth. Progressive calculation: partial results are still useful. **Day-1 edge case:** On first run (no cache exists), the Sheet is the only valid source. If the Sheet also fails on first run, display "No market breadth data available — check Sheet access" and skip regime classification (use CAUTIOUS as safe default).

### Failure Scenario 4: Prolonged Sheet Outage — No EM for Extended Period
**Trigger:** Sheet maintainer stops updating or Google restricts gviz endpoint for weeks. The system has been running on breadth-only fallback with no EM, and insufficient parallel data has been collected to reverse-engineer the formula.
**Impact:** User loses the north star metric their entire trading framework is built around. Breadth-only regime is coarser and the user may lose confidence in the system.
**Mitigation:** (a) The breadth-only fallback uses conservative thresholds to bias toward caution. (b) 52WH/52WL secondary confirmation: if 52WL > 52WH, regime is downgraded regardless. (c) User always sees raw breadth components and can manually read EM from the Sheet website. (d) `stark market` clearly labels "Breadth-only mode — check EM manually from Sheet" so the user never forgets. (e) If sufficient parallel data was collected before the outage, prioritize regression analysis to derive an EM approximation.

---

## Detailed Design

### What Gets Implemented: Mini MBI + Key Full MBI Metrics

The user is a swing trader. Per the sheet notes, "Mini MBI is only for swing traders." Therefore:

**Core (Mini MBI -- always calculated):**
- `EM` -- Easy Money (primary regime signal, proprietary formula, Sheet-only via gviz CSV)
- `52WH` -- % stocks at 52-week highs
- `52WL` -- % stocks at 52-week lows
- `4.5r` -- Advance/decline ratio at 4.5% threshold

**Extended (Full MBI -- calculated when data available):**
- `20sma` -- % stocks above 20-SMA
- `50sma` -- % stocks above 50-SMA
- `200+` / `200-` -- % stocks above/below 200-SMA (replaces the PRD's vague "breadth" metric)
- `F10`, `F20`, `F50` -- Breadth momentum filters (derived oscillators)

**Not implemented in v1:**
- Day-over-day change columns (`chng`) -- trivially derived from stored history
- Color coding rules -- UI concern, deferred to Phase 4
- `4.5+/4.5-`, `10+/10-`, `20+/20-`, `50+/50-` raw counts -- intermediate values, not directly actionable

### MBI Replaces the Market Regime Classifier

The current plan (Step 2.2) defines:
```
BULL: price > 50-DMA > 200-DMA AND breadth > 60%
BEAR: price < 50-DMA < 200-DMA AND breadth < 40%
CHOPPY: everything else
```

MBI replaces this with a richer, multi-signal classification:

```
STRONG BULL:  EM > 25                           -> "Large positions OK"
BULL:         EM > 15                           -> "Best swing environment"
CAUTIOUS:     EM 12-15 AND 52WL <= 1            -> "Good setups only"
CHOPPY:       EM 9.5-12 OR (52WL > 1 AND 52WL > 52WH) -> "Spurt entries only"
BEAR:         EM < 9.5                          -> "Avoid long trading"
```

**Threshold mapping to existing focus list logic:**

| MBI Regime | Score Threshold | Max Focus Stocks | Position Size |
|-----------|----------------|-----------------|--------------|
| STRONG BULL | 8.0 | 5 | Full |
| BULL | 8.0 | 5 | Full |
| CAUTIOUS | 8.5 | 3 | 75% |
| CHOPPY | 9.0 | 2 | 50% |
| BEAR | N/A | 0 | No new longs (override: `stark focus --override-regime`) |

This preserves the existing 3-tier threshold logic (8.0/8.5/9.0) but maps it to MBI-derived regimes instead of the naive Nifty-vs-MA approach.

### Breadth-Only Fallback Regime Classifier (When Chartink is Unavailable)

The EM formula is proprietary (Stocksgeeks / "Finally Nitin") and **we do not know it**. EM measures follow-through in the market — how easily money is being made. We cannot fabricate an approximation without data to validate it against.

**v1 approach:** When Chartink is unavailable, classify regime using raw breadth metrics directly:

```typescript
// Breadth-only fallback classifier (no EM)
// Uses conservative thresholds — biased toward caution when EM is absent

function classifyRegimeFromBreadth(data: BreadthData): { regime: MBIRegime; confidence: 'breadth_only' } {
  const { pct52WH, pct52WL, pctAbove50SMA, pctAbove200SMA } = data;

  // 52WH/52WL spread is the most EM-correlated signal we have
  const highLowHealthy = pct52WH > pct52WL && pct52WL < 1;
  const highLowStrong = pct52WH > 3 && pct52WL < 0.5;
  const highLowWeak = pct52WL > pct52WH;

  // Breadth trend confirmation
  const broadBullish = pctAbove50SMA > 65 && pctAbove200SMA > 55;
  const broadBearish = pctAbove50SMA < 35 && pctAbove200SMA < 45;

  if (highLowStrong && broadBullish)          return { regime: 'BULL', confidence: 'breadth_only' };
  if (highLowHealthy && pctAbove50SMA > 55)   return { regime: 'CAUTIOUS', confidence: 'breadth_only' };
  if (broadBearish || highLowWeak)            return { regime: 'BEAR', confidence: 'breadth_only' };
  return { regime: 'CHOPPY', confidence: 'breadth_only' };
}
```

**Key differences from EM-based classification:**
- **No STRONG_BULL tier** — without EM, we cannot confidently distinguish STRONG_BULL from BULL. Default to BULL (conservative).
- **Conservative bias** — thresholds are tighter than the EM-based classifier. Better to under-classify (CAUTIOUS when market is BULL) than over-classify (BULL when market is CHOPPY).
- **Always labeled "breadth-only"** — the UI shows `"(breadth-only, no EM)"` so the user knows to cross-check against their Sheet.

**Future: EM Reverse-Engineering**
After collecting 30+ days of parallel data (Sheet EM stored alongside raw breadth inputs in `mbi_daily`), attempt regression analysis to derive EM weights. This is a Phase 3+ activity:
- `stark mbi analyze` — shows correlation between raw breadth metrics and Sheet EM
- If R² > 0.85, propose a derived EM formula for user validation
- If validated, promote derived EM to fallback mode (replacing breadth-only classifier)

### F10/F20/F50 Breadth Filters

Based on the sheet structure (0-100 scale values that appear to track breadth momentum at different periods):

```
F10 = Breadth oscillator (10-period): rate of change in % stocks above 10-SMA
F20 = Breadth oscillator (20-period): rate of change in % stocks above 20-SMA
F50 = Breadth oscillator (50-period): rate of change in % stocks above 50-SMA
```

These are likely smoothed momentum indicators showing whether breadth is expanding or contracting. They add value as **trend confirmation** but are NOT used in EM calculation or regime classification.

**v1 decision:** Calculate and store F10/F20/F50 but do NOT integrate them into scoring or regime logic. Display them in `stark market` output for informational purposes. Integrate into scoring only after the user validates their predictive value against their own trades (Phase 3 performance analytics).

### Data Flow Integration

```
Evening Workflow (stark evening):
  1. [EXISTING] Check Angel One session
  2. [NEW] Fetch MBI data (three-tier fallback):
     a. Try Google Sheet (gviz CSV) -> parse all MBI columns including EM
     b. If Sheet fails -> try Chartink scraper -> raw breadth only (no EM)
     c. If Chartink fails -> self-calculate breadth from Angel One OHLCV (no EM)
     d. Store in mbi_daily table with source flag
  3. [MODIFIED] Classify market regime using MBI (replaces Nifty-vs-MA)
  4. [EXISTING] Score all Priority 0 stocks
  5. [MODIFIED] Generate focus list with MBI-derived thresholds
  6. [NEW] Display MBI summary in evening report

Morning Workflow (stark morning):
  1. [EXISTING] Check overnight gaps
  2. [NEW] Fetch fresh MBI (intraday breadth may have shifted)
  3. [MODIFIED] Re-validate focus list against current MBI regime
  4. [NEW] Warn if regime downgraded overnight (e.g., BULL -> CHOPPY)

CLI Output (stark market):
  Market Regime: BULL (EM: 18.3)
  Source: Sheet (fresh)

  Mini MBI:
    EM:    18.3  [==========--------]  Best swing environment
    52WH:  3.2%  52WL: 0.4%           Market is strong (52WL < 1)
    4.5r:  285                         OK to Good day

  Extended Breadth:
    20-SMA: 72%  50-SMA: 68%  200-SMA: 61%
    F10: 65  F20: 58  F50: 72

  Action: Score threshold 8.0 | Up to 5 focus stocks | Full position size
```

### Database Schema Changes

```sql
-- New table: daily MBI snapshots
CREATE TABLE mbi_daily (
    date TEXT NOT NULL,             -- YYYY-MM-DD
    captured_at TEXT NOT NULL DEFAULT 'eod',  -- 'eod' for end-of-day, ISO timestamp for intraday (Seam 7)
    source TEXT NOT NULL,           -- 'sheet' | 'chartink' | 'breadth_only' | 'stale_cache'

    -- Mini MBI (core)
    em REAL,                        -- Easy Money (proprietary, Chartink-only; NULL when breadth-only fallback)
    pct_52wh REAL,                  -- % stocks at 52-week highs
    pct_52wl REAL,                  -- % stocks at 52-week lows
    ratio_4_5 REAL,                 -- Advance/decline ratio at 4.5%

    -- Extended breadth
    pct_above_20sma REAL,
    pct_above_50sma REAL,
    pct_above_200sma REAL,
    pct_below_200sma REAL,

    -- Breadth filters
    f10 REAL,
    f20 REAL,
    f50 REAL,

    -- Raw source data (stored as JSON for full fidelity)
    raw_source_json TEXT,           -- All columns from Sheet CSV or Chartink HTML (whichever was the source)

    -- Metadata
    fetched_at TEXT NOT NULL,
    data_freshness TEXT DEFAULT 'fresh',  -- 'fresh' | 'stale'

    PRIMARY KEY (date, captured_at)       -- Composite key supports intraday snapshots (Seam 7)
);

-- Modify existing market_context table to reference MBI
-- (market_context keeps Nifty price + MAs for the regime classifier,
--  but regime is now derived from MBI)
ALTER TABLE market_context ADD COLUMN mbi_regime TEXT;      -- 'STRONG_BULL' | 'BULL' | 'CAUTIOUS' | 'CHOPPY' | 'BEAR'
ALTER TABLE market_context ADD COLUMN mbi_em REAL;
ALTER TABLE market_context ADD COLUMN mbi_source TEXT;
```

### Google Sheet Client Design (Primary Source)

```
packages/core/src/api/mbi-sheet.ts

MBISheetClient:
  - fetchMBI(): Promise<MBIData>
  - Endpoint: https://docs.google.com/spreadsheets/d/{SHEET_ID}/gviz/tq?tqx=out:csv&gid={GID}
  - Sheet ID: 1SkXCX1Ax3n_EUsa06rzqWSdoCrlbGDENuFUOrMFyErw
  - Main MBI: gid=0, Mini MBI: gid=<mini-mbi-tab-id>
  - Parse CSV response into MBIData structure (all columns including EM)
  - No auth needed — gviz endpoint works for publicly viewable sheets
  - Rate limit: 1 request per session (daily)
  - Error handling: timeout (10s), CSV parse failure, HTTP errors -> trigger Chartink fallback
  - Cache raw CSV response for debugging
  - Freshness check: compare date column with today — warn if stale (>1 trading day old)
  - Store Sheet ID and GID in config for easy update if sheet changes
```

### Chartink Scraper Design (Secondary Fallback — Raw Breadth Only)

```
packages/core/src/api/chartink.ts

ChartinkClient:
  - fetchDashboard(dashboardId: string): Promise<BreadthData>  (NOT MBIData — no EM)
  - Dashboard URL: https://chartink.com/dashboard/291317
  - Parse HTML table or JSON API response (Chartink may serve data via XHR)
  - Rate limit: 1 request per scrape session (daily)
  - Auth: MUST investigate if Chartink requires login BEFORE implementation (manual 30-min check).
  - User-Agent: mimic browser to avoid blocks
  - Error handling: timeout (10s), parse failure, HTTP errors -> trigger Angel One fallback
  - Cache raw response for debugging
  - NOTE: Chartink does NOT provide EM — only raw breadth metrics
```

### Self-Calculated Breadth Engine

```
packages/core/src/market/breadth-calculator.ts

BreadthCalculator:
  - calculateBreadth(universe: 'NIFTY50' | 'NIFTY500'): Promise<BreadthData>
  - Requires: OHLCV for all constituents (from cache or fresh fetch)
  - Calculates:
    - % above each SMA (10, 20, 50, 200)
    - 52-week high/low percentages
    - 4.5% advance/decline ratio
    - F10/F20/F50 oscillators
  - Does NOT calculate EM (proprietary formula, unknown)
  - Progressive: returns partial results if some stocks fail
  - Universe constituents: fetch NIFTY 500 list from NSE (cache weekly)
```

### File Structure (New/Modified)

```
packages/core/src/
  api/
    mbi-sheet.ts             [NEW] Google Sheet gviz CSV client (primary MBI + EM source)
    chartink.ts              [NEW] Chartink dashboard scraper (secondary, raw breadth only, no EM)
  market/                    [NEW DIRECTORY]
    breadth-calculator.ts    [NEW] Self-calculated breadth from OHLCV
    mbi.ts                   [NEW] MBI data manager (Chartink + fallback + storage)
    regime-classifier.ts     [NEW -- replaces main plan Step 2.2's naive classifier. The naive Nifty-vs-MA regime classifier is NOT built; MBI takes its place entirely.]
    fallback-classifier.ts   [NEW] Breadth-only regime classifier (used when Chartink/EM unavailable)
  models/
    market.ts                [MODIFIED] Add MBIData, BreadthData, MBIRegime interfaces
  db/
    schema.ts                [MODIFIED] Add mbi_daily table, modify market_context

packages/cli/src/commands/
  market.ts                  [MODIFIED] Display MBI summary instead of basic regime
  evening.ts                 [MODIFIED] Add MBI fetch step
  morning.ts                 [MODIFIED] Add MBI refresh + regime change warning
```

---

## Task Flow

```
Step 1: Data Models + DB Schema
  |
  v
Step 2: Breadth Engine + Fallback Classifier (fallback-first development)
  |
  v
Step 3: Sheet Client + Chartink Scraper + MBI Data Manager
  |
  v
Step 4: MBI-Based Regime Classifier (replaces Step 2.2 in main plan)
  |
  v
Step 5: CLI Integration + Evening/Morning Workflow Changes
  |
  v
Step 6: Parallel Data Collection + Future EM Reverse-Engineering
```

---

## Detailed TODOs

### Step 1: Data Models + DB Schema

- Define TypeScript interfaces in `packages/core/src/models/market.ts`:
  - `MBIData`: all MBI fields (mini + extended)
  - `BreadthData`: raw breadth percentages for self-calculation
  - `MBIRegime`: `'STRONG_BULL' | 'BULL' | 'CAUTIOUS' | 'CHOPPY' | 'BEAR'`
  - `MBISource`: `'sheet' | 'chartink' | 'breadth_only' | 'stale_cache'`
  - `EMThresholds`: configurable threshold ranges for EM-based regime mapping
- Add `mbi_daily` table to DB schema
- Add MBI columns to `market_context` table
- Add MBI configuration to `~/.stark/config.json` schema:
  ```json
  {
    "mbi": {
      "em_thresholds": { "strong_bull": 25, "bull": 15, "cautious": 12, "choppy": 9.5 },
      "primary_source": "sheet",
      "universe": "NIFTY500"
    }
  }
  ```
  Note: No `em_weights` — EM is proprietary and comes only from the Sheet. Thresholds are configurable for the EM-based classifier. The breadth-only fallback has its own hardcoded conservative thresholds.

**Acceptance Criteria:**
- All MBI interfaces compile with strict TypeScript
- `mbi_daily` table creates successfully via migration
- Config schema validates EM thresholds and weights
- Existing `market_context` table preserved with new columns added

### Step 2: Self-Calculated Breadth Engine

- Implement `BreadthCalculator` in `packages/core/src/market/breadth-calculator.ts`:
  - Accept stock universe (NIFTY 50 or NIFTY 500 constituent list)
  - For each stock: fetch OHLCV (from cache or API), calculate SMA values
  - Compute: % above 10/20/50/200-SMA, 52WH %, 52WL %, 4.5r ratio
  - Progressive results: return partial breadth even if some stocks fail
- Implement `BreadthFallbackClassifier` in `packages/core/src/market/fallback-classifier.ts`:
  - Input: `BreadthData` output (52WH%, 52WL%, SMA%, 4.5r)
  - Output: `MBIRegime` + `confidence: 'breadth_only'`
  - Conservative thresholds — biased toward caution when EM is absent
  - No STRONG_BULL tier (cannot distinguish without EM)
- Implement F10/F20/F50 oscillators:
  - Rate of change in breadth percentages over 10/20/50 day windows
  - Requires historical breadth data (store daily snapshots)
- Fetch NIFTY 500 constituent list from NSE indices CSV download (niftyindices.com). Fallback: hardcoded list in `config/nifty500.json`, updated manually if NSE changes format. Cache for 7 days.
- Optimize: prioritize NIFTY 50 first (quick result), then expand to NIFTY 500

**Bootstrap / Cold Start:**
The `BreadthCalculator` requires 252 trading days of OHLCV history per stock for 52WH/52WL calculations, and 200 days for 200-SMA. On first run, this data does not exist in the cache.

- **First-run bootstrap:** Batch-fetch 260 trading days of OHLCV for NIFTY 50 (~50 API calls, ~1 min) and optionally NIFTY 500 (~500 calls, ~8 min). This is a one-time cost on initial setup.
- **Until warm, the Sheet is the only valid EM source.** `BreadthCalculator.isWarm(): boolean` returns `false` until sufficient history exists (>=200 days for SMA, >=252 days for 52WH/52WL). The breadth-only fallback cannot be used until the calculator is warm.
- **Progressive warming:** After bootstrap, daily OHLCV fetches extend the cache naturally. The 52W window is fully populated after one trading day of bootstrap data.
- **`stark setup` command** should include the bootstrap fetch as part of initial configuration (after Angel One auth).

**Acceptance Criteria:**
- `BreadthCalculator` produces breadth percentages for NIFTY 50 using cached OHLCV data
- `BreadthFallbackClassifier` produces a valid regime from raw breadth metrics (no EM)
- Fallback classifier defaults to conservative tier (never STRONG_BULL without EM)
- Partial results returned when some stocks fail (logs which stocks skipped)
- Constituent list cached and refreshed weekly (source: NSE CSV, fallback: hardcoded JSON)
- F10/F20/F50 produce 0-100 values when sufficient history exists (NaN with warning otherwise)
- `BreadthCalculator.isWarm()` returns `false` when insufficient history, preventing breadth-only fallback from being used
- Bootstrap fetch completes for NIFTY 50 in <2 minutes on first run

### Step 3: Sheet Client + Chartink Scraper + MBI Data Manager

- Implement `MBISheetClient` in `packages/core/src/api/mbi-sheet.ts`:
  - Fetch MBI data via `gviz/tq?tqx=out:csv` endpoint (no auth)
  - Parse CSV into `MBIData` structure (all columns including EM)
  - Freshness check: warn if date column is >1 trading day old
  - Cache raw CSV to `~/.stark/cache/sheet/` for debugging
  - Config-driven Sheet ID and GID for easy update
- Implement `ChartinkClient` in `packages/core/src/api/chartink.ts`:
  - Fetch dashboard 291317 HTML/JSON
  - Investigate: does Chartink serve data via XHR API (check network tab) or inline HTML table?
  - Parse raw breadth columns into `BreadthData` structure (no EM)
  - Handle: login requirements, CAPTCHA, rate limits, parse failures
  - Cache raw response to `~/.stark/cache/chartink/` for debugging
- Implement `MBIDataManager` in `packages/core/src/market/mbi.ts`:
  - Orchestrates data acquisition: try Sheet -> fallback to Chartink (no EM) -> fallback to Angel One breadth (no EM)
  - Stores daily snapshot in `mbi_daily` table
  - Tags data with source ('sheet' | 'chartink' | 'breadth_only')
  - When Sheet available: store EM alongside raw breadth inputs for future regression analysis
  - Stale data handling: if today's fetch fails entirely, use yesterday's data with 'stale_cache' flag

**Acceptance Criteria:**
- Sheet client fetches and parses all MBI columns including EM for current date (or returns structured error)
- Sheet client detects stale data (date > 1 trading day old) and warns user
- Sheet client validates response: Content-Type is CSV (not HTML login page), expected column headers present, date column matches recent trading day
- Chartink scraper fetches and parses raw breadth data (no EM) for current date (or returns structured error)
- MBI data manager falls back correctly: Sheet (with EM) → Chartink (no EM) → Angel One breadth (no EM)
- Sheet path produces `MBIData` with EM; Chartink/breadth paths produce `MBIData` with EM=NULL
- Raw responses cached for debugging (Sheet CSV + Chartink HTML)
- Stale cache used with warning when all three sources fail
- `mbi_daily` table populated with source attribution ('sheet', 'chartink', or 'breadth_only')

### Step 4: MBI-Based Regime Classifier

- Implement `MarketRegimeClassifier` in `packages/core/src/market/regime-classifier.ts`:
  - **Primary path (EM available from Sheet):** Apply EM thresholds from config: STRONG_BULL (>25), BULL (>15), CAUTIOUS (12-15), CHOPPY (9.5-12), BEAR (<9.5)
  - **Fallback path (no EM):** Delegate to `BreadthFallbackClassifier` which uses raw breadth metrics (no STRONG_BULL tier, conservative thresholds)
  - Apply 52WH/52WL rules as secondary confirmation (both paths):
    - If 52WL > 1 AND 52WL > 52WH: downgrade by one tier (e.g., BULL -> CAUTIOUS)
    - If only one condition met: add "progressive exposure" flag
  - Apply 4.5r as daily strength indicator (informational, not regime-changing)
  - Map MBI regime to focus list parameters: score threshold, max stocks, position size modifier
  - Retain Nifty-vs-MA as a tertiary signal (logged but not driving decisions)
- Update `market_context` storage to include MBI regime + EM value (EM=NULL when breadth-only)

**Acceptance Criteria:**
- EM-based classifier produces correct regime for known EM values (unit test with fixtures)
- Breadth-only fallback produces valid regime when EM=NULL (never STRONG_BULL)
- 52WH/52WL downgrade logic works in EM path: EM=16 with 52WL>52WH -> CAUTIOUS instead of BULL
- 52WH/52WL downgrade logic works in breadth-only path: fallback returns BULL, but 52WL>52WH -> downgrade to CAUTIOUS
- Focus list threshold mapping returns correct values for each regime tier
- Nifty-vs-MA data still stored but not used for regime (backward compatible)
- Config-driven thresholds: changing `em_thresholds.bull` from 15 to 14 changes EM-based classification

### Step 5: CLI Integration + Workflow Changes

- Update `stark market` command:
  - Display Mini MBI summary (EM, 52WH, 52WL, 4.5r) with thresholds and interpretation
  - Display extended breadth (SMA percentages, F10/F20/F50)
  - Show regime classification with recommended action
  - Show data source and freshness
- Update `stark evening` workflow:
  - Add MBI fetch as step 2 (after auth check, before scoring)
  - Display MBI summary before scoring begins
  - If MBI regime is BEAR: prompt user "Market is weak (EM: X). Continue scoring? [Y/n]"
- Update `stark morning` workflow:
  - Refresh MBI data
  - Compare with last evening's regime -- warn if downgraded
  - If regime downgraded: flag affected focus list stocks
- Update focus list generator to use MBI-derived thresholds and position size modifiers
- Update trade journal auto-capture: store MBI regime + EM (when available) at entry time (richer than just BULL/CHOPPY/BEAR)
- When in breadth-only mode, `stark market` shows "Breadth-only mode (no EM) — check EM manually from Sheet"

**Acceptance Criteria:**
- `stark market` displays full MBI dashboard with interpretation text
- `stark evening` fetches MBI data before scoring and displays regime
- `stark morning` detects regime changes and warns user
- Focus list respects MBI-derived thresholds (e.g., only 2 stocks in CHOPPY)
- Trade journal captures 5-tier MBI regime instead of 3-tier

### Step 6: Parallel Data Collection + Future EM Reverse-Engineering

- Every day the Sheet is available: store Sheet EM value alongside ALL raw breadth inputs (52WH%, 52WL%, SMA crossovers, 4.5r, F10/F20/F50) in `mbi_daily`
- This builds the training dataset for future regression analysis to reverse-engineer the EM formula
- After 30+ days of data: CLI command `stark mbi analyze` shows:
  - Correlation matrix: which raw breadth metrics correlate most strongly with Sheet EM
  - R² of regression models: `EM ~ f(52WH, 52WL, SMA20, SMA50, 4.5r)` — try linear, polynomial (degree 2-3), and decision tree since EM's "follow-through" concept likely has non-linear threshold effects
  - If best R² > 0.85: propose a derived EM formula for user validation
  - If best R² < 0.5 after 60+ days: accept that EM cannot be reverse-engineered from these inputs alone — breadth-only fallback becomes the permanent backup, and the user should maintain Sheet access as the primary workflow
- Regime agreement: compare breadth-only fallback regime vs what EM would have classified — shows how often the fallback gets it right
- This step is **passive** — data collection happens automatically as part of Step 3. Analysis is on-demand.

**Acceptance Criteria:**
- Every Sheet fetch stores EM + raw breadth inputs in `mbi_daily` (no data loss)
- `stark mbi analyze` generates correlation report after 30+ days of data
- Report shows R² and which inputs are most predictive of EM
- Regime agreement % shows fallback accuracy
- If R² > 0.85, actionable formula proposal is displayed for user review

---

## Expanded Test Plan (Deliberate Mode)

### Unit Tests
- EM-based regime classifier: boundary values (9.4, 9.5, 9.6, 11.9, 12.0, 14.9, 15.0, 24.9, 25.0)
- Breadth-only fallback classifier: produces valid regime from raw breadth metrics without EM
- Breadth-only fallback: never produces STRONG_BULL (requires EM)
- 52WH/52WL downgrade logic: all 4 combinations (neither, 52WL>1 only, 52WL>52WH only, both)
- BreadthCalculator: partial stock failures produce valid partial results
- Threshold mapping: each regime tier maps to correct focus list parameters

### Integration Tests
- Full pipeline: mock Sheet CSV -> parse -> classify regime with EM -> generate focus list thresholds
- Fallback chain: Sheet fails -> Chartink raw breadth (no EM) -> Angel One breadth (no EM) -> regime still classified
- Stale cache: both sources fail -> yesterday's data used with stale flag
- Evening workflow: MBI fetch integrates correctly with scoring pipeline
- DB roundtrip: write MBI snapshot -> read back -> values match (EM=NULL for breadth-only)

### E2E Tests
- `stark market` with live Sheet data (manual smoke test, not automated)
- `stark evening` full run with MBI integration (manual, requires Angel One auth)
- Regime change detection across two `stark morning` runs (mock data)

### Observability
- Scoring log entries for MBI data source (sheet/chartink/breadth_only), fetch duration, fallback triggers
- API tracker: Sheet fetch, Chartink fetch, Angel One calls counted separately
- `stark status` shows: last MBI fetch time, source used, EM value, regime
- Warning log when: Sheet fails (no EM), Chartink fails (breadth-only mode active), stale data used, bootstrap incomplete

---

## Integration with Existing Stark Plan

This plan **modifies** the following sections of `dexter-trading-implementation.md` v5:

### Phase 1 Changes
- **Step 1.1 (Schema):** Add `mbi_daily` table to initial schema creation. Add MBI columns to `market_context`. No other changes.
- **Step 1.2 (APIs):** Add `mbi-sheet.ts` (primary, gviz CSV) and `chartink.ts` (secondary, raw breadth) to the API client list. Add NIFTY 500 constituent list fetch to NSE client. No changes to Angel One client.

### Phase 2 Changes (PRIMARY IMPACT)
- **Step 2.2 (Market Context):** REPLACED. The naive Nifty-vs-MA + undefined "breadth %" classifier becomes the MBI-based regime classifier. This is the core of this plan. The sector money flow analysis is UNCHANGED.
- **Step 2.2 (Focus List):** MODIFIED. Threshold logic changes from 3-tier (8.0/8.5/9.0) to 5-tier mapped from MBI regimes. Position size modifier added.
- **Step 2.3 (Workflows):** MODIFIED. Evening and morning workflows gain MBI fetch steps.

### Phase 3 Changes
- **Step 3.1 (Journal):** MODIFIED. Trade journal auto-captures 5-tier MBI regime + EM value instead of 3-tier.
- **Step 3.3 (Performance):** ENHANCED. "Win rate by market regime" analysis now uses 5 MBI tiers instead of 3, providing finer-grained insights.

### Phase 4 Changes
- **UI Dashboard:** Add MBI visualization (Mini MBI gauge, extended breadth bars, regime indicator with color coding per sheet rules).

### Implementation Order
MBI Steps 1-2 can be built during Phase 1 (alongside schema + API work). Steps 3-5 replace the Phase 2 Step 2.2 work. Step 6 runs passively during Phase 2-3.

---

## Risk Register (MBI-Specific)

| Risk | Likelihood | Impact | Mitigation | Status |
|------|-----------|--------|------------|--------|
| Google Sheet / gviz endpoint becomes unavailable | MEDIUM | HIGH | Three-tier fallback: Chartink raw breadth → Angel One breadth-only. EM is lost but coarser regime classification still functional. User can read EM manually from Sheet website. | MITIGATED |
| Chartink blocks scraping | HIGH | LOW | Sheet is primary source (not Chartink). Chartink is only secondary fallback for raw breadth. Angel One is tertiary. | MITIGATED |
| Breadth-only fallback disagrees with EM | MEDIUM | MEDIUM | Conservative thresholds bias toward caution. User can cross-check EM from Sheet website. Parallel data collection enables future reverse-engineering. | ACCEPTED |
| Angel One rate limits block 500-stock breadth fetch | MEDIUM | MEDIUM | Progressive calculation (NIFTY 50 first). Aggressive caching. Stale data fallback. | MITIGATED |
| NIFTY 500 constituent list unavailable from NSE | LOW | LOW | Fallback: hardcoded list updated monthly. Or use NIFTY 50 only (less accurate but functional). | ACCEPTED |
| No EM available when Sheet is down | HIGH | LOW | Breadth-only fallback provides basic regime. User can manually read EM from Sheet website. Future: reverse-engineer EM from parallel data. | ACCEPTED |
| Scope creep: user wants all 24 MBI columns in CLI | LOW | LOW | Start with Mini MBI + key extended metrics. Add columns only when user requests. | ACCEPTED |

---

## Success Criteria

1. `stark market` displays MBI-derived regime classification with EM value, 52WH/52WL, and 4.5r
2. Evening workflow fetches MBI data automatically from Sheet (no manual reading/copying)
3. Focus list thresholds dynamically adjust based on 5-tier MBI regime
4. When Chartink is down, breadth-only fallback provides usable (coarser) regime classification without EM
5. Trade journal captures MBI regime + EM value (when available) for post-hoc performance analysis
6. After 30+ days of parallel data, `stark mbi analyze` shows correlation between raw breadth metrics and Sheet EM for future reverse-engineering
