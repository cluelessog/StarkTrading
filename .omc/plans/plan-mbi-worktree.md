# MBI Integration Worktree: Implementation Plan (Steps 2-6)

**Created:** 2026-03-11
**Status:** v2 -- RALPLAN CONSENSUS APPROVED (Architect + Critic)
**Worktree:** `feat/mbi-integration` at `/mnt/d/Projects/SteveTrading-mbi`
**Executor:** Single `/ralph` agent
**Scope:** Steps 2-6 of `stark-mbi-integration.md` (Step 1 is complete on master)

---

## RALPLAN-DR Summary

### Principles

1. **Fallback-first development.** Build the breadth-only fallback (Step 2) before the primary Sheet/Chartink clients (Step 3). This ensures the system always has a working regime classifier even if external sources fail.
2. **Incremental integration.** Each step produces independently testable artifacts. The executor should commit after each step, not batch everything into one commit.
3. **Existing patterns over invention.** Use the project's established patterns: `withFallback` utility for cascading fallback, `DataProvider` interface for OHLCV access, `Queries` class for DB operations (never raw SQL in commands), `bun:test` + `bun:sqlite` in-memory DB for tests, test files in `packages/core/tests/`. New test files use `import { describe, it, expect } from 'bun:test'` (the project's forward direction, matching `claude-client.test.ts` and other recent tests).
4. **Conservative scope.** Step 6 (EM regression analysis) is scaffolding only -- a `stark mbi analyze` command stub with correlation report. Do not build ML infrastructure.
5. **No breaking changes.** All existing tests (172 pass, 3 pre-existing fail) must continue passing. CLI commands that already work must not regress.

### Decision Drivers

1. **What already exists vs. what remains:** Step 1 is fully complete (models, schema, queries, basic data-manager, regime-classifier, focus-list). The existing `MBIDataManager` has Sheet client + stale cache fallback but no Chartink or breadth-only fallback. The `regime-classifier.ts` has `classifyRegime` (EM-based) and `classifyFromBreadth` but lacks 52WH/52WL downgrade logic and config-driven thresholds.
2. **API cost of breadth calculation:** Self-calculated breadth requires fetching OHLCV for 500 stocks. The `AngelOneProvider.fetchOHLCV()` already exists and returns `OHLCVBar[]`. The `OHLCVCache` class handles caching. The breadth calculator needs to orchestrate batch fetching through the existing provider + cache.
3. **Test infrastructure location:** Tests live in `packages/core/tests/` (flat directory, not `__tests__`). They use `bun:test` (newer convention) with `bun:sqlite` in-memory DB and the `createTestDb()` helper pattern from `focus-list.test.ts`. New test files use `import { describe, it, expect, mock } from 'bun:test'`.

### Viable Options

#### Option A: Sequential Step-by-Step (RECOMMENDED)

**Approach:** Implement Steps 2-6 sequentially, each building on the previous. Commit after each step. Test after each step.

**Pros:**
- Each step is independently verifiable
- Natural dependency ordering (Step 3 depends on Step 2's `BreadthData` type, Step 4 depends on Step 3's fallback chain)
- Single agent can maintain context across steps
- Matches the source plan's task flow exactly

**Cons:**
- No parallelism within the MBI worktree
- Sequential means ~3-5 hours wall-clock

#### Option B: Parallel Core + CLI Split

**Approach:** Build Steps 2-4 (core logic) in parallel with Step 5 (CLI integration), then merge.

**Why invalidated:** Steps 2-4 produce the APIs that Step 5 consumes. CLI integration cannot proceed without the `MBIDataManager` having the full fallback chain (Step 3) and enhanced regime classifier (Step 4). Parallelizing would require stub interfaces that add complexity for no time savings in a single-agent workflow.

---

## ADR: Architecture Decision Record

### Decision
Option A: Sequential step-by-step implementation within the `feat/mbi-integration` worktree.

### Drivers
- Step 1 artifacts already exist and provide stable interfaces
- Each subsequent step depends on the previous step's outputs
- Single-agent execution makes parallelism overhead unjustified

### Alternatives Considered
- Option B (parallel core + CLI): Invalidated because CLI depends on complete core APIs

### Why Chosen
Sequential execution with per-step commits gives the executor clear checkpoints and allows rollback to any step boundary if issues arise. The dependency chain (2 -> 3 -> 4 -> 5 -> 6) is strict.

### Consequences
- Wall-clock time ~3-5 hours for a single agent
- Each commit is independently testable
- If Step 3 (Chartink scraper) proves difficult, it can be stubbed and deferred without blocking Steps 4-5

### Follow-ups
- Post-merge: Add logging instrumentation to MBI workflow steps (from Logging worktree integration pass)
- Post-merge: Verify full test suite on master after merge

---

## What Already Exists (Step 1 -- COMPLETE)

Before defining remaining work, here is an exact inventory of what is implemented on master:

| Artifact | File | Status |
|---|---|---|
| `MBIData`, `BreadthData`, `MBIRegime`, `MBISource`, `EMThresholds`, `MarketContext` | `packages/core/src/models/market.ts` | DONE |
| `mbi_daily` table (composite PK) | `packages/core/src/db/schema.ts` | DONE |
| `market_context` table with `mbi_regime`, `mbi_em`, `mbi_source` columns | `packages/core/src/db/schema.ts` | DONE |
| `upsertMBIDaily()`, `getLatestMBI()` queries | `packages/core/src/db/queries.ts` | DONE |
| `UpsertMBIData` interface, `MBIDailyRow` type, `rowToMBIData()` mapper | `packages/core/src/db/queries.ts` | DONE |
| `classifyRegime(em, thresholds)` -- EM-based 5-tier classifier | `packages/core/src/mbi/regime-classifier.ts` | DONE |
| `classifyFromBreadth(mbi)` -- breadth-only fallback | `packages/core/src/mbi/regime-classifier.ts` | DONE |
| `fetchMBIFromSheet(config)` -- Google Sheet gviz CSV client | `packages/core/src/mbi/data-manager.ts` | DONE |
| `MBIDataManager` class with Sheet + stale-cache fallback | `packages/core/src/mbi/data-manager.ts` | DONE |
| `generateFocusList(db, regime, registry)` | `packages/core/src/mbi/focus-list.ts` | DONE |
| `emThresholds` + `sheetId` in config | `packages/core/src/config/index.ts` | DONE |
| `withFallback()` utility | `packages/core/src/utils/fallback.ts` | DONE |
| Regime classifier tests (7 tests) | `packages/core/tests/regime-classifier.test.ts` | DONE |
| Focus list tests (4 tests) | `packages/core/tests/focus-list.test.ts` | DONE |
| `stark market` command (basic MBI display) | `packages/cli/src/commands/market.ts` | DONE |
| `stark evening` command (MBI fetch + focus list) | `packages/cli/src/commands/evening.ts` | DONE |
| `stark morning` command (basic, no MBI refresh yet) | `packages/cli/src/commands/morning.ts` | PARTIAL |

---

## Step 2: Breadth Calculator + Fallback Classifier Enhancement

**Goal:** Build the self-calculated breadth engine that serves as the tertiary fallback (Angel One OHLCV -> breadth percentages). Also enhance the existing `classifyFromBreadth` with the plan's specified logic.

### Files to Create

#### `packages/core/src/market/breadth-calculator.ts` (NEW, ~200 lines)

```typescript
export interface BreadthCalculatorConfig {
  universe: 'NIFTY50' | 'NIFTY500';
  nifty50Constituents: ConstituentInfo[];
  nifty500Constituents?: ConstituentInfo[];
}

export interface ConstituentInfo {
  symbol: string;
  token: string;
}

export interface BreadthResult {
  pct52WH: number;         // % stocks at 52-week high
  pct52WL: number;         // % stocks at 52-week low
  pctAbove20SMA: number;   // % above 20-day SMA
  pctAbove50SMA: number;   // % above 50-day SMA
  pctAbove200SMA: number;  // % above 200-day SMA
  pctBelow200SMA: number;  // % below 200-day SMA
  ratio4_5: number;        // A/D ratio at 4.5% threshold
  f10: number;             // 10-period breadth oscillator (0-100)
  f20: number;             // 20-period breadth oscillator (0-100)
  f50: number;             // 50-period breadth oscillator (0-100)
  totalStocks: number;
  successfulStocks: number;
  failedStocks: string[];  // symbols that failed
}

export class BreadthCalculator {
  private queries: Queries;  // created internally from db, matching MBIDataManager pattern

  constructor(
    private provider: DataProvider,
    private db: DatabaseAdapter,
    private config: BreadthCalculatorConfig,
  ) {
    this.queries = new Queries(db);
  }

  async calculateBreadth(): Promise<BreadthResult>
  isWarm(): boolean                     // true when >=200 days of OHLCV history exists
  private async fetchStockOHLCV(symbol: string, token: string): Promise<OHLCVBar[]>
  private calculateSMA(bars: OHLCVBar[], period: number): number | null
  private is52WeekHigh(bars: OHLCVBar[]): boolean
  private is52WeekLow(bars: OHLCVBar[]): boolean
  private calculateAdvanceDecline(bars: Map<string, OHLCVBar[]>, threshold: number): number
  private calculateOscillator(
    currentPct: number,
    historicalPcts: number[],
    period: number,
  ): number
}
```

**Implementation details:**
- Use the existing `DataProvider.fetchOHLCV()` for each constituent stock
- Use the existing `Queries.getOHLCV()` and `Queries.upsertOHLCV()` for caching
- Fetch 260 trading days of daily OHLCV for each stock (covers 52W + buffer)
- Calculate SMA by averaging closing prices over the specified window
- 52WH = close >= max(close[last 252 days]); 52WL = close <= min(close[last 252 days])
- 4.5r = count(change > 4.5%) / count(change < -4.5%) for the day's advance/decline
- F10/F20/F50: Rate of change in %above-SMA over 10/20/50 day windows, scaled to 0-100
- `isWarm()`: Check if the DB has >= 200 days of OHLCV for at least 80% of NIFTY 50 constituents
- Progressive results: If some stocks fail to fetch, compute breadth from successful ones and log failures
- Prioritize NIFTY 50 first (50 stocks), then optionally NIFTY 500

#### `packages/core/src/market/nifty-constituents.ts` (NEW, ~80 lines)

```typescript
export interface ConstituentList {
  symbols: ConstituentInfo[];
  source: 'nse_csv' | 'hardcoded';
  fetchedAt: string;
}

// Primary: hardcoded NIFTY 50 symbols (Angel One instrument master has NO index membership data)
export function getNifty50Constituents(): ConstituentInfo[]

// Resolve Angel One tokens for symbols via instrument master
export async function resolveTokens(
  provider: DataProvider,
  symbols: ConstituentInfo[],
): Promise<ConstituentInfo[]>

// Future enhancement: fetch from NSE CSV (niftyindices.com)
// export async function fetchNifty50FromNSE(): Promise<ConstituentList>
```

**Implementation details:**
- **Primary:** Hardcoded array of 50 `{ symbol, token }` entries for current NIFTY 50 constituents. Angel One's `RawInstrument` type has NO `indexMembership` field — filtering by NIFTY membership is not possible via the instrument master.
- **Token resolution:** Use `provider.getInstrumentMaster('NSE')` to look up Angel One tokens by symbol name. This handles token changes without updating the hardcoded list.
- Hardcoded list needs manual update ~2-4 times/year when NIFTY 50 constituents change.
- **Future:** NSE CSV download from `niftyindices.com` as automated alternative (not in scope for v1).
- Cache resolved tokens for 7 days (use `Queries.upsertSetting()` / `Queries.getSetting()`)

#### `packages/core/src/market/fallback-classifier.ts` (NEW, ~60 lines)

```typescript
import type { BreadthData, MBIRegime } from '../models/market.js';

export interface FallbackClassification {
  regime: MBIRegime;
  confidence: 'breadth_only';
  reason: string;
}

export function classifyFromBreadthDetailed(data: BreadthData): FallbackClassification
```

**Implementation details:**
- Extract and enhance the logic currently in `regime-classifier.ts` `classifyFromBreadth()`
- Use the plan's specified thresholds: `highLowHealthy`, `highLowStrong`, `highLowWeak`, `broadBullish`, `broadBearish`
- Never return `STRONG_BULL` (conservative bias)
- Include `reason` string explaining why the classification was made (for display in CLI)
- The existing `classifyFromBreadth` in `regime-classifier.ts` will delegate to this function

#### `packages/core/src/market/index.ts` (NEW, ~5 lines)

```typescript
export { BreadthCalculator } from './breadth-calculator.js';
export { classifyFromBreadthDetailed } from './fallback-classifier.js';
export { getNifty50Constituents, resolveTokens } from './nifty-constituents.js';
```

### Files to Modify

#### `packages/core/src/mbi/regime-classifier.ts` (MODIFY)

- Add `classifyFromBreadthDetailed` import and delegate `classifyFromBreadth()` to it
- Add 52WH/52WL downgrade logic as a new exported function:

```typescript
export function applySecondaryConfirmation(
  regime: MBIRegime,
  pct52WH: number,
  pct52WL: number,
): { regime: MBIRegime; downgraded: boolean; reason?: string }
```

- Downgrade rule: if `pct52WL > 1 AND pct52WL > pct52WH`, downgrade one tier
- Tier ordering: STRONG_BULL -> BULL -> CAUTIOUS -> CHOPPY -> BEAR
- Make `classifyRegime` accept optional `EMThresholds` from config (already does this)

### Tests to Write

#### `packages/core/tests/breadth-calculator.test.ts` (NEW, ~120 lines)

- Test SMA calculation with known data (e.g., 200 bars of linear prices)
- Test 52WH/52WL detection with boundary values
- Test partial failure handling (3/5 stocks succeed -> breadth from 3)
- Test `isWarm()` returns false when insufficient history
- Mock the `DataProvider` -- do NOT make real API calls

#### `packages/core/tests/fallback-classifier.test.ts` (NEW, ~80 lines)

- Test all regime outputs: BULL, CAUTIOUS, CHOPPY, BEAR
- Test never returns STRONG_BULL
- Test with edge-case breadth values (all zeros, all 100s, mixed)
- Test `reason` string is populated

#### Enhance `packages/core/tests/regime-classifier.test.ts` (MODIFY, +30 lines)

- Add tests for `applySecondaryConfirmation`:
  - EM=16 (BULL) + 52WL > 52WH -> downgraded to CAUTIOUS
  - EM=16 (BULL) + 52WL < 52WH -> remains BULL
  - EM=9.5 (CHOPPY) + 52WL > 52WH -> downgraded to BEAR
  - BEAR cannot be downgraded further (stays BEAR)

### Acceptance Criteria

- [ ] `BreadthCalculator.calculateBreadth()` produces valid `BreadthResult` from mocked OHLCV data
- [ ] `BreadthCalculator.isWarm()` returns false when <200 days of data exist
- [ ] `classifyFromBreadthDetailed()` never returns STRONG_BULL
- [ ] `applySecondaryConfirmation()` correctly downgrades BULL -> CAUTIOUS when 52WL > 52WH
- [ ] All new tests pass
- [ ] Existing 172 tests still pass
- [ ] `bun run typecheck` passes (if configured) or `tsc --noEmit` passes

### Estimated Lines

- New files: ~345 lines (breadth-calculator 200 + nifty-constituents 80 + fallback-classifier 60 + index 5)
- Modified files: ~40 lines (regime-classifier enhancements)
- Test files: ~230 lines (breadth-calculator 120 + fallback-classifier 80 + regime-classifier +30)
- **Total: ~615 lines**

---

## Step 3: Chartink Scraper + Enhanced MBI Data Manager

**Goal:** Add Chartink as secondary fallback. Enhance `MBIDataManager` with the full 3-tier fallback chain: Sheet -> Chartink (raw breadth) -> Angel One (self-calculated breadth).

**Dependencies:** Step 2 (BreadthCalculator, fallback-classifier)

### Files to Create

#### `packages/core/src/api/chartink.ts` (NEW, ~150 lines)

```typescript
export interface ChartinkConfig {
  dashboardId: string;  // default: '291317'
  timeoutMs: number;    // default: 10000
}

export interface ChartinkBreadthData {
  pct52WH: number;
  pct52WL: number;
  pctAbove20SMA: number;
  pctAbove50SMA: number;
  pctAbove200SMA: number;
  ratio4_5: number;
  rawHtml?: string;      // stored for debugging
  fetchedAt: string;
}

export class ChartinkClient {
  constructor(private config: ChartinkConfig) {}

  async fetchDashboard(): Promise<ChartinkBreadthData>
  private parseHTML(html: string): ChartinkBreadthData
  private parseXHRJSON(json: unknown): ChartinkBreadthData
}
```

**Implementation details (STUB-FIRST in v1):**
- **v1: Implement as a stub.** `fetchDashboard()` throws `new Error('Chartink scraper not yet implemented -- use Sheet or breadth_only fallback')`. The `withFallback` chain correctly catches this and moves to `breadth_only`.
- The full interface (`ChartinkConfig`, `ChartinkBreadthData`, `ChartinkClient`) is defined so the slot exists in the fallback chain for future implementation.
- Does NOT provide EM (the plan explicitly states this)
- **Future (post-merge follow-up):** Investigate Chartink feasibility (login walls, CAPTCHA, HTML structure). If viable, implement actual scraping with HTML parsing, browser-like User-Agent, 10s timeout, and raw HTML caching to `~/.stark/cache/chartink/`.
- Return type `ChartinkBreadthData` maps to `BreadthData` (subset of `MBIData` with `em: null`)

### Files to Modify

#### `packages/core/src/mbi/data-manager.ts` (MODIFY, significant changes)

The current `MBIDataManager.getLatestRegime()` has a 2-option fallback (Sheet + stale cache). Enhance to 4-option fallback:

```typescript
// Enhanced fallback chain in getLatestRegime():
const result = await withFallback([
  {
    name: 'sheet',
    fn: () => fetchMBIFromSheet(this.sheetConfig),
  },
  {
    name: 'chartink',
    fn: async () => {
      const breadth = await this.chartinkClient.fetchDashboard();
      return this.breadthToMBIData(breadth, 'chartink');
    },
  },
  {
    name: 'breadth_only',
    fn: async () => {
      if (!this.breadthCalculator?.isWarm()) {
        throw new Error('Breadth calculator not warm (insufficient OHLCV history)');
      }
      const breadth = await this.breadthCalculator.calculateBreadth();
      return this.breadthResultToMBIData(breadth);
    },
  },
  {
    name: 'stale_cache',
    fn: async () => {
      if (cached) return { ...cached, dataFreshness: 'stale' as const, source: 'stale_cache' as MBISource };
      throw new Error('No cached MBI data');
    },
  },
]);
```

- Add constructor parameters for `ChartinkClient` and `BreadthCalculator` (both optional)
- Add `breadthToMBIData()` helper: converts `ChartinkBreadthData` to `MBIData` with `em: null`
- Add `breadthResultToMBIData()` helper: converts `BreadthResult` to `MBIData` with `em: null`. Must map ALL overlapping fields: `pct52WH`, `pct52WL`, `pctAbove20SMA`, `pctAbove50SMA`, `pctAbove200SMA`, `pctBelow200SMA`, `ratio4_5`, `f10`, `f20`, `f50` (not just the `BreadthData` subset)
- Apply `applySecondaryConfirmation()` after regime classification
- Update `market_context` table after regime classification via `Queries`
- Add `refreshMBI()` method for morning workflow (forces fresh fetch, ignores cache)
- Store raw source JSON in `raw_source_json` column for Sheet CSV and Chartink HTML
- Track fallback usage via `Queries.upsertApiUsage()` for each source attempted

#### `packages/core/src/db/queries.ts` (MODIFY, ~30 lines)

Add `market_context` CRUD methods (table exists in schema but has zero query methods):

```typescript
// Insert/update market context for a date
upsertMarketContext(data: {
  date: string;
  mbiRegime: MBIRegime;
  mbiEm: number | null;
  mbiSource: MBISource;
}): void

// Get latest market context for a date (or most recent if no date)
getMarketContextForDate(date?: string): {
  date: string;
  mbi_regime: MBIRegime;
  mbi_em: number | null;
  mbi_source: MBISource;
  created_at: string;
} | null
```

These are used by:
- Step 3: `MBIDataManager` stores regime after classification
- Step 5: `morning.ts` reads previous regime for change detection

#### `packages/core/src/api/index.ts` (MODIFY, +1 line)

- Add: `export { ChartinkClient } from './chartink.js';`

#### `packages/core/src/mbi/index.ts` (MODIFY, +1 line)

- Re-export the market module's `BreadthCalculator`

### Tests to Write

#### `packages/core/tests/chartink.test.ts` (NEW, ~30 lines)

- Test that `fetchDashboard()` throws with "not yet implemented" message (stub behavior)
- Test that `ChartinkClient` can be instantiated with config
- Test that the stub error is caught correctly by `withFallback` (fallback chain integration)

#### `packages/core/tests/data-manager.test.ts` (NEW, ~150 lines)

- Test full fallback chain: mock Sheet to fail -> mock Chartink to succeed -> verify `source: 'chartink'`
- Test all sources fail -> stale cache used -> verify `source: 'stale_cache'`, `dataFreshness: 'stale'`
- Test Sheet succeeds -> verify EM is populated, `source: 'sheet'`
- Test breadth_only fallback when Chartink fails but BreadthCalculator is warm
- Test breadth_only skipped when BreadthCalculator is NOT warm (falls through to stale cache)
- Test `refreshMBI()` forces fresh fetch (ignores today's cache)
- Test DB upsert is called with correct data after each fallback path
- Use in-memory `bun:sqlite` DB with `createTestDb()` pattern

### Acceptance Criteria

- [ ] `ChartinkClient` exists as stub; `fetchDashboard()` throws "not yet implemented"
- [ ] `MBIDataManager` falls back: Sheet -> Chartink (stub throws) -> breadth_only -> stale_cache
- [ ] When Sheet succeeds, `MBIData.em` is populated and `source` is `'sheet'`
- [ ] Chartink stub is correctly skipped by fallback chain (falls through to breadth_only)
- [ ] When breadth_only succeeds, `MBIData.em` is `null` and `source` is `'breadth_only'`
- [ ] Stale cache has `dataFreshness: 'stale'`
- [ ] `mbi_daily` table is populated after each fetch with correct `source` attribution
- [ ] `raw_source_json` stores the original CSV/HTML for debugging
- [ ] All new tests pass; existing tests unaffected

### Estimated Lines

- New files: ~40 lines (chartink.ts stub with types)
- Modified files: ~130 lines (data-manager.ts rewrite of fallback chain, queries.ts +30 for market_context, api/index.ts, mbi/index.ts)
- Test files: ~180 lines (chartink 30 + data-manager 150)
- **Total: ~350 lines**

---

## Step 4: Enhanced Regime Classifier

**Goal:** Wire the regime classifier to use config-driven thresholds, apply 52WH/52WL downgrade from `applySecondaryConfirmation()`, integrate 4.5r as informational signal, and map regime to focus list parameters.

**Dependencies:** Steps 2-3 (fallback classifier, enhanced data manager)

### Files to Modify

#### `packages/core/src/mbi/regime-classifier.ts` (MODIFY, ~50 additional lines)

Add a unified classification function that orchestrates the full pipeline:

```typescript
export interface RegimeClassification {
  regime: MBIRegime;
  em: number | null;
  source: MBISource;
  downgraded: boolean;
  downgradeReason?: string;
  confidence: 'em_based' | 'breadth_only';
  ratio4_5Interpretation: string;   // 'Strong day' | 'OK day' | 'Weak day'
  focusParams: {
    scoreThreshold: number;
    maxStocks: number;
    positionSizeModifier: number;   // 1.0 = full, 0.75, 0.5, 0
  };
}

export function classifyRegimeFull(
  mbi: MBIData,
  thresholds?: EMThresholds,
): RegimeClassification
```

**Implementation details:**
- If `mbi.em != null`: use `classifyRegime(mbi.em, thresholds)`, set confidence = `'em_based'`
- If `mbi.em == null`: use `classifyFromBreadthDetailed(mbi)`, set confidence = `'breadth_only'`
- Apply `applySecondaryConfirmation(regime, mbi.pct52WH, mbi.pct52WL)` to get final regime
- Map 4.5r to interpretation: >300 = 'Strong day', 200-300 = 'OK day', <200 = 'Weak day'
- Map regime to focus params using the table from the source plan:
  - STRONG_BULL: threshold 7.5, max 5, modifier 1.0
  - BULL: threshold 8.0, max 5, modifier 1.0
  - CAUTIOUS: threshold 8.5, max 3, modifier 0.75
  - CHOPPY: threshold 9.0, max 2, modifier 0.5
  - BEAR: threshold 10.0, max 0, modifier 0

#### `packages/core/src/mbi/data-manager.ts` (MODIFY, ~20 lines)

- Update `getLatestRegime()` to use `classifyRegimeFull()` instead of separate `classifyRegime`/`classifyFromBreadth` calls
- Store `RegimeClassification` in return type
- Update `market_context` table with regime + EM + source after classification

#### `packages/core/src/mbi/focus-list.ts` (MODIFY, ~15 lines)

- Update `generateFocusList()` to accept optional `RegimeClassification` and use its `focusParams` for thresholds/maxStocks instead of hardcoded `BASE_THRESHOLDS` and `MAX_FOCUS`
- Keep backward compatibility: if `RegimeClassification` not provided, fall back to current behavior

### Tests to Add

#### Enhance `packages/core/tests/regime-classifier.test.ts` (MODIFY, +60 lines)

- Test `classifyRegimeFull()` end-to-end:
  - Sheet data (EM=18.3, 52WH=3.2, 52WL=0.4) -> BULL, em_based, not downgraded, focusParams.maxStocks=5
  - Sheet data (EM=16, 52WL=2, 52WL > 52WH) -> CAUTIOUS (downgraded from BULL), em_based, downgraded=true
  - Breadth-only data (no EM, strong breadth) -> BULL, breadth_only, never STRONG_BULL
  - Breadth-only data (no EM, weak breadth) -> BEAR, breadth_only
  - BEAR regime with 52WL > 52WH -> stays BEAR (cannot downgrade further)
  - EM boundary values: 9.4 -> BEAR, 9.5 -> CHOPPY, 12.0 -> CAUTIOUS, 15.0 -> BULL, 25.0 -> STRONG_BULL
- Test 4.5r interpretation mapping
- Test focus params mapping for each regime tier
- Test config-driven thresholds: custom thresholds change classification

### Acceptance Criteria

- [ ] `classifyRegimeFull()` returns complete `RegimeClassification` object
- [ ] 52WH/52WL downgrade works: BULL + bad 52W spread -> CAUTIOUS
- [ ] Focus params correctly mapped for all 5 regime tiers
- [ ] Config-driven thresholds: changing `emThresholds.bull` from 15 to 14 changes classification for EM=14.5
- [ ] 4.5r interpretation strings correct for boundary values
- [ ] `generateFocusList()` respects `RegimeClassification.focusParams` when provided
- [ ] All tests pass

### Estimated Lines

- Modified files: ~85 lines (regime-classifier 50 + data-manager 20 + focus-list 15)
- Test additions: ~60 lines
- **Total: ~145 lines**

---

## Step 5: CLI Integration + Workflow Changes

**Goal:** Update `stark market`, `stark evening`, and `stark morning` commands to display the full MBI dashboard, fetch MBI as part of workflows, and warn on regime changes.

**Dependencies:** Steps 2-4 (complete MBI pipeline)

### Files to Modify

#### `packages/cli/src/commands/market.ts` (MODIFY, rewrite ~80 lines)

Replace the current minimal output with the full MBI dashboard from the source plan:

```
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

**Implementation details:**
- Create a `formatMBIDashboard(classification: RegimeClassification, mbi: MBIData): string` helper
- EM bar: scale EM to a 0-30 range, render as `[====----]` style progress bar
- Show "Breadth-only mode (no EM) -- check EM manually from Sheet" when `confidence === 'breadth_only'`
- Show downgrade warning if `classification.downgraded === true`
- Extended breadth section only shown when SMA/filter data is available (non-null)
- Keep the existing LLM narrative as an optional section

#### `packages/cli/src/commands/evening.ts` (MODIFY, ~40 additional lines)

- Move MBI fetch to happen BEFORE scoring (currently it is after)
- Display the Mini MBI summary before scoring begins
- If regime is BEAR: print warning "Market is weak (EM: X). Scoring will continue but focus list will be empty."
- After scoring, display focus list with regime-adjusted thresholds
- Store regime classification in `market_context` table

Current flow (lines 29-39) becomes:

```typescript
// 2. Fetch MBI data (before scoring)
const mbiManager = new MBIDataManager(db, {
  sheetId: config.sheetId,
  // Pass optional chartinkClient and breadthCalculator when available
});
const mbiResult = await mbiManager.getLatestRegime();
const classification = classifyRegimeFull(mbiResult.mbi, config.emThresholds);

console.log(formatMBISummary(classification, mbiResult.mbi));

if (classification.regime === 'BEAR') {
  console.log('\n  WARNING: Market is weak. Focus list will be empty.\n');
}

// 3. Score batch
// ... existing scoring code ...

// 4. Focus list with regime-adjusted params
const focusList = generateFocusList(db, classification.regime, registry);
```

#### `packages/cli/src/commands/morning.ts` (MODIFY, ~60 additional lines)

- Add MBI refresh before quote checking
- Compare current regime with last evening's regime (read from `market_context` table)
- If regime downgraded: display warning with affected focus stocks

```typescript
// 2. Refresh MBI
const mbiManager = new MBIDataManager(db, { sheetId: config.sheetId });
const currentMBI = await mbiManager.refreshMBI();
const currentClassification = classifyRegimeFull(currentMBI.mbi, config.emThresholds);

// Compare with evening regime (using Queries abstraction, not raw SQL)
const lastContext = queries.getMarketContextForDate(today);

if (lastContext?.mbi_regime && lastContext.mbi_regime !== currentClassification.regime) {
  const direction = REGIME_ORDER[currentClassification.regime] < REGIME_ORDER[lastContext.mbi_regime]
    ? 'DOWNGRADED' : 'UPGRADED';
  console.log(`\n  REGIME ${direction}: ${lastContext.mbi_regime} -> ${currentClassification.regime}`);
  if (direction === 'DOWNGRADED') {
    console.log('  Re-validate focus list stocks before entry.\n');
  }
}
```

#### `packages/cli/src/utils/command-context.ts` (MODIFY, ~10 lines)

- Add `MBIDataManager` to `CommandContext` interface and factory
- Initialize with Sheet config + optional Chartink/Breadth dependencies

### Files to Create

#### `packages/core/src/mbi/format.ts` (NEW, ~100 lines)

> **Note:** Lives in `packages/core` (not CLI) because it only consumes core types (`RegimeClassification`, `MBIData`). Tested from `packages/core/tests/mbi-format.test.ts` without cross-package imports. Exported via `packages/core/src/mbi/index.ts`.

```typescript
export function formatMBIDashboard(
  classification: RegimeClassification,
  mbi: MBIData,
): string

export function formatMBISummary(
  classification: RegimeClassification,
  mbi: MBIData,
): string   // Compact single-line version for evening/morning workflows

function renderEMBar(em: number | null, width: number): string
function interpretRegime(regime: MBIRegime): string
```

### Tests to Write

No new test files for CLI commands (they are integration-tested via manual smoke tests). However:

#### `packages/core/tests/mbi-format.test.ts` (NEW, ~60 lines)

- Test `formatMBIDashboard()` output contains expected strings for each regime
- Test `renderEMBar()` visual correctness at boundary values (0, 9.5, 15, 25, 30)
- Test breadth-only mode shows appropriate warning text
- Test downgrade warning appears when `classification.downgraded === true`

### Acceptance Criteria

- [ ] `stark market` displays the full MBI dashboard with EM bar, breadth, and action recommendation
- [ ] `stark market` shows "Breadth-only mode" warning when EM unavailable
- [ ] `stark evening` fetches MBI BEFORE scoring and displays Mini MBI summary
- [ ] `stark evening` warns when regime is BEAR
- [ ] `stark morning` detects regime changes and displays UPGRADED/DOWNGRADED warning
- [ ] `stark morning` advises re-validating focus list when regime downgraded
- [ ] Focus list uses regime-adjusted thresholds from `RegimeClassification.focusParams`
- [ ] `CommandContext` includes `MBIDataManager` for consistent initialization
- [ ] All existing tests pass

### Estimated Lines

- New files: ~100 lines (mbi-format.ts)
- Modified files: ~190 lines (market.ts 80 + evening.ts 40 + morning.ts 60 + command-context.ts 10)
- Test files: ~60 lines (mbi-format.test.ts)
- **Total: ~350 lines**

---

## Step 6: Parallel Data Collection + EM Analysis Scaffolding

**Goal:** Ensure every Sheet fetch stores EM alongside raw breadth for future regression analysis. Add a `stark mbi analyze` command stub that shows correlation after 30+ days.

**Dependencies:** Steps 3-5 (MBI data being stored daily)

### Data Collection (Automatic -- Verify Only)

The data collection is ALREADY happening via Step 3's `MBIDataManager`:
- Every call to `getLatestRegime()` stores the full `MBIData` (including EM when from Sheet) in `mbi_daily`
- The `raw_source_json` column preserves the original CSV for future parsing
- Verify: EM from Sheet is stored as a number, raw breadth inputs from the same fetch are in the same row

No new code needed for data collection -- just verify the Step 3 implementation stores everything correctly.

### Files to Create

#### `packages/cli/src/commands/mbi-analyze.ts` (NEW, ~120 lines)

```typescript
export async function mbiAnalyzeCommand(_args: string[]): Promise<void>
```

**Implementation details:**
- Query `mbi_daily` for all rows where `source = 'sheet'` and `em IS NOT NULL`
- If < 30 rows: print "Need 30+ days of Sheet data for analysis. Currently have N days."
- If >= 30 rows:
  - Calculate Pearson correlation between EM and each raw breadth metric (52WH%, 52WL%, SMA%, 4.5r)
  - Display correlation matrix
  - Attempt simple linear regression: `EM ~ a*52WH + b*52WL + c*SMA50 + d*4.5r + e`
  - Display R-squared value
  - If R-squared > 0.85: suggest derived formula for user validation
  - Compare breadth-only fallback regime vs EM-based regime for each day: show agreement %
- All math is pure TypeScript -- no external libraries needed for Pearson correlation and simple linear regression
- This is a scaffolding command; it provides useful insights but does not auto-promote any derived formula

```
$ stark mbi analyze

MBI Parallel Data Analysis
==========================
Days of Sheet data: 45 (2026-01-25 to 2026-03-11)

Correlation with EM:
  52WH%:      +0.72
  52WL%:      -0.68
  50-SMA%:    +0.81
  200-SMA%:   +0.65
  4.5r:       +0.43

Linear Regression: EM ~ breadth inputs
  R-squared: 0.74
  Status: Insufficient fit (need R² > 0.85 for derived EM)

Regime Agreement (breadth-only vs EM-based):
  Agreement: 78% (35/45 days)
  Disagreements: mostly BULL vs CAUTIOUS boundary

Recommendation: Continue collecting data. Current R² of 0.74 suggests
raw breadth alone cannot fully predict EM. Consider polynomial model
after 60+ days.
```

#### Register the command in CLI entry point

- Register `mbi-analyze` in the CLI command router (wherever `market`, `evening`, `morning` are registered)

### Files to Modify

#### `packages/cli/bin/stark.ts` or equivalent command router (MODIFY, ~5 lines)

- Add `'mbi-analyze'` or `'mbi'` subcommand routing to `mbiAnalyzeCommand`

### Tests to Write

#### `packages/core/tests/mbi-analyze.test.ts` (NEW, ~80 lines)

- Test Pearson correlation calculation with known data (e.g., perfectly correlated -> 1.0)
- Test linear regression with known coefficients
- Test with < 30 data points -> returns insufficient data message
- Test regime agreement calculation

Extract the math functions into a testable module:

#### `packages/core/src/mbi/analysis.ts` (NEW, ~80 lines)

```typescript
export function pearsonCorrelation(x: number[], y: number[]): number
export function linearRegression(
  X: number[][],  // matrix of inputs (N rows x M features)
  y: number[],    // target values (N rows)
): { coefficients: number[]; rSquared: number; intercept: number }
export function regimeAgreement(
  emRegimes: MBIRegime[],
  breadthRegimes: MBIRegime[],
): { agreement: number; total: number; disagreements: Array<{ day: string; em: MBIRegime; breadth: MBIRegime }> }
```

### Acceptance Criteria

- [ ] Every Sheet fetch stores EM + raw breadth in `mbi_daily` (verified via Step 3)
- [ ] `stark mbi analyze` runs without error
- [ ] With < 30 days of data: shows "need more data" message
- [ ] With >= 30 days of mocked data: shows correlation matrix and R-squared
- [ ] Pearson correlation returns correct values for known test data
- [ ] Linear regression returns correct coefficients for known test data
- [ ] Regime agreement percentage correctly computed

### Estimated Lines

- New files: ~280 lines (mbi-analyze.ts 120 + analysis.ts 80 + mbi-analyze.test.ts 80)
- Modified files: ~5 lines (command router)
- **Total: ~285 lines**

---

## Test Plan Summary

### Unit Tests (new files)

| Test File | Tests | Verifies |
|---|---|---|
| `packages/core/tests/breadth-calculator.test.ts` | ~6 tests | SMA calculation, 52WH/52WL detection, partial failure, isWarm() |
| `packages/core/tests/fallback-classifier.test.ts` | ~5 tests | All regime outputs, never STRONG_BULL, edge values |
| `packages/core/tests/chartink.test.ts` | ~3 tests | Stub throws, instantiation, fallback chain integration |
| `packages/core/tests/data-manager.test.ts` | ~7 tests | Full fallback chain, DB roundtrip, stale cache, refreshMBI |
| `packages/core/tests/mbi-format.test.ts` | ~4 tests | Dashboard formatting, EM bar, breadth-only warning |
| `packages/core/tests/mbi-analyze.test.ts` | ~4 tests | Pearson correlation, regression, insufficient data, agreement |

### Enhanced Existing Tests

| Test File | Additions | Verifies |
|---|---|---|
| `packages/core/tests/regime-classifier.test.ts` | +8 tests | classifyRegimeFull, 52WH/52WL downgrade, boundary values, config thresholds, 4.5r interpretation |

### Integration Tests (within unit test files)

- `data-manager.test.ts`: Full fallback chain with in-memory DB
- `data-manager.test.ts`: DB roundtrip (write MBI -> read back -> values match)

### E2E / Manual Smoke Tests

After all steps complete, manually verify:
1. `stark market` -- displays MBI dashboard (requires Sheet access or graceful fallback)
2. `stark evening --help` -- shows updated help text
3. `stark mbi analyze` -- runs (will show "need more data" on first run)

### Total New Tests: ~38 tests across 6 new files + 1 enhanced file

---

## Verification Checklist

Run these commands after ALL steps are complete, from the MBI worktree:

```bash
# 1. Type check
cd /mnt/d/Projects/SteveTrading-mbi
bun run typecheck 2>/dev/null || npx tsc --noEmit

# 2. Copy to test location and run tests
# (Tests must run from /mnt/c/ due to NTFS node_modules requirement)
rsync -a --delete /mnt/d/Projects/SteveTrading-mbi/packages/ /mnt/c/SteveTrading-mbi/packages/
cd /mnt/c/SteveTrading-mbi
bun test

# Expected: 172 + ~38 new = ~210 passing, 3 pre-existing failures

# 3. Verify no regressions
bun test packages/core/tests/regime-classifier.test.ts   # existing + new
bun test packages/core/tests/focus-list.test.ts           # existing, unmodified
bun test packages/core/tests/scoring-engine.test.ts       # unmodified
bun test packages/core/tests/fallback.test.ts             # unmodified

# 4. Verify new test files pass
bun test packages/core/tests/breadth-calculator.test.ts
bun test packages/core/tests/fallback-classifier.test.ts
bun test packages/core/tests/chartink.test.ts
bun test packages/core/tests/data-manager.test.ts
bun test packages/core/tests/mbi-format.test.ts
bun test packages/core/tests/mbi-analyze.test.ts

# 5. Verify new files exist
ls packages/core/src/market/breadth-calculator.ts
ls packages/core/src/market/fallback-classifier.ts
ls packages/core/src/market/nifty-constituents.ts
ls packages/core/src/market/index.ts
ls packages/core/src/api/chartink.ts
ls packages/core/src/mbi/analysis.ts
ls packages/cli/src/commands/mbi-analyze.ts
ls packages/core/src/mbi/format.ts

# 6. Verify imports resolve
bun run --bun -e "import { BreadthCalculator } from '@stark/core/market/index.js'; console.log('OK')"
bun run --bun -e "import { ChartinkClient } from '@stark/core/api/chartink.js'; console.log('OK')"
```

---

## Commit Strategy

One commit per step, with descriptive messages:

1. **Step 2 commit:** `feat(mbi): add breadth calculator, fallback classifier, and 52WH/52WL downgrade logic`
2. **Step 3 commit:** `feat(mbi): add Chartink scraper and 3-tier fallback chain in MBIDataManager`
3. **Step 4 commit:** `feat(mbi): add classifyRegimeFull with config-driven thresholds and focus params`
4. **Step 5 commit:** `feat(mbi): update CLI commands with MBI dashboard, regime warnings, and morning refresh`
5. **Step 6 commit:** `feat(mbi): add stark mbi analyze command for EM regression scaffolding`

---

## Risk Notes

1. **Chartink is stubbed in v1:** `ChartinkClient` interface is defined but `fetchDashboard()` throws "not yet implemented". The fallback chain is effectively Sheet → breadth_only → stale_cache. Actual Chartink scraper implementation is a follow-up task after manual feasibility investigation (login walls, CAPTCHA, HTML structure stability).

2. **NIFTY 50 constituent list:** The hardcoded list is the PRIMARY source (Angel One instrument master has no index membership data). Token resolution uses the instrument master by symbol name matching. The hardcoded list needs manual update ~2-4 times/year when NIFTY 50 constituents change.

3. **BreadthCalculator cold start:** On first run, `isWarm()` returns false and the breadth_only fallback is skipped. This is correct behavior -- the Sheet is the only valid source until sufficient OHLCV history is cached. The bootstrap fetch (260 days of OHLCV for 50 stocks) is a one-time ~1 minute operation that happens naturally during the first `stark evening` run.

4. **Test file location:** All test files go in `packages/core/tests/` (NOT `__tests__` subdirectories within `src/`). The `mbi-format.test.ts` tests `packages/core/src/mbi/format.ts` — both live in core, no cross-package imports needed.

---

## Total Estimated Size

| Step | New Lines | Modified Lines | Test Lines | Total |
|---|---|---|---|---|
| Step 2: Breadth Engine | 345 | 40 | 230 | 615 |
| Step 3: Chartink (stub) + Data Manager | 40 | 130 | 180 | 350 |
| Step 4: Enhanced Classifier | 0 | 85 | 60 | 145 |
| Step 5: CLI Integration | 100 | 190 | 60 | 350 |
| Step 6: Analysis Scaffolding | 280 | 5 | 0 (included in new) | 285 |
| **TOTAL** | **765** | **450** | **530** | **~1,745** |

This is within the estimated range from the parallel plan (1500-2500 lines).

---

## Consensus Record

**Planner v1:** Created 5-step sequential plan (Steps 2-6) with ~1,875 lines across ~15 files, ~38 new tests.

**Architect Review (v1) — ITERATE** with 7 issues:
1. NIFTY constituents: Angel One instrument master has no index membership → hardcoded must be primary *(MANDATORY)*
2. Missing `market_context` query methods in Queries class *(MANDATORY)*
3. `mbi-format.ts` package boundary violation (CLI util tested from core) *(RECOMMENDED)*
4. Test import convention unspecified (vitest vs bun:test) *(RECOMMENDED)*
5. BreadthCalculator DB access pattern *(RECOMMENDED)*
6. BreadthResult→MBIData field mapping incomplete *(RECOMMENDED)*
7. STRONG_BULL threshold discrepancy (plan 7.5 vs design doc 8.0) *(INFORMATIONAL)*

**Architect Antithesis:** Chartink scraping is highest-risk item — recommend stub-first, actual scraper as follow-up.

**Critic Evaluation (v1) — ITERATE** with 3 mandatory + 2 recommended:
1. Fix NIFTY constituent strategy *(MANDATORY — agreed with Architect)*
2. Add market_context queries *(MANDATORY — agreed with Architect)*
3. Make Chartink stub-first *(MANDATORY — agreed with Architect antithesis)*
4. Move mbi-format.ts to core *(RECOMMENDED)*
5. Explicit bun:test guidance *(RECOMMENDED)*

**v2 Revision:** All 3 mandatory + 2 recommended + 2 additional Architect fixes applied. Risk Note #2 updated to match. Chartink reduced to ~40-line stub. Line estimates updated (~1,745 total).

**Architect Re-review (v2) — APPROVED.** All 7 suggestions verified. One stale Risk Note found and fixed.

**Critic Re-evaluation (v2) — APPROVED.** All 5 fixes verified against codebase. Representative task simulations passed. No contradictions found.

**Final Status:** v2 — CONSENSUS APPROVED
