# PRD: Sprint 1 — MBI Integration (Steps 2-6)

**Created:** 2026-03-12
**Execution plan:** `plan-mbi-worktree.md`
**Worktree:** `feat/mbi-integration`
**Baseline:** 172 tests pass, 3 pre-existing failures

---

## Problem Statement

MBI Step 1 (schema, models, basic data manager) is on master but the system lacks: self-calculated breadth fallback, enhanced regime classification with 52WH/52WL downgrade, config-driven thresholds, full CLI dashboard, and EM regression analysis. The `MBIDataManager` has only a 2-tier fallback (Sheet + stale cache).

## Goals

- 3-tier fallback chain: Sheet → breadth_only → stale_cache (Chartink stubbed for v1)
- Unified `classifyRegimeFull()` with downgrade logic, focus params, and 4.5r interpretation
- Full MBI dashboard in `stark market`
- Regime-aware `stark evening` (MBI before scoring, BEAR warning)
- Morning regime change detection in `stark morning`
- `stark mbi analyze` for EM regression scaffolding

## Non-Goals

- Actual Chartink scraper implementation (stub only)
- Real-time/intraday MBI refresh
- NSE CSV download for NIFTY constituents (hardcoded list is primary)

## Technical Constraints

- New test files use `import { ... } from 'bun:test'`
- Format utilities live in `packages/core/src/mbi/format.ts` (not CLI)
- Use `Queries` class abstraction, never raw SQL in commands
- Hardcoded NIFTY 50 list is PRIMARY (Angel One has no index membership data)
- `BreadthCalculator` creates `new Queries(db)` internally

## Acceptance Criteria

### Step 2: Breadth Calculator + Fallback Classifier
- [ ] `BreadthCalculator.calculateBreadth()` produces valid `BreadthResult` from mocked OHLCV
- [ ] `BreadthCalculator.isWarm()` returns false when <200 days of data exist
- [ ] `classifyFromBreadthDetailed()` never returns STRONG_BULL
- [ ] `applySecondaryConfirmation()` downgrades BULL → CAUTIOUS when 52WL > 52WH
- [ ] BEAR cannot be downgraded further (stays BEAR)
- [ ] `getNifty50Constituents()` returns hardcoded list of 50 symbols
- [ ] All new Step 2 tests pass

### Step 3: Chartink Stub + Enhanced Data Manager
- [ ] `ChartinkClient` exists as stub; `fetchDashboard()` throws "not yet implemented"
- [ ] `MBIDataManager` falls back: Sheet → Chartink (stub throws) → breadth_only → stale_cache
- [ ] When Sheet succeeds: `MBIData.em` populated, `source: 'sheet'`
- [ ] When breadth_only succeeds: `MBIData.em` is null, `source: 'breadth_only'`
- [ ] Stale cache has `dataFreshness: 'stale'`
- [ ] `queries.upsertMarketContext()` and `queries.getMarketContextForDate()` exist and work
- [ ] `mbi_daily` table populated after each fetch with correct source
- [ ] `breadthResultToMBIData()` maps ALL fields: pct52WH, pct52WL, pctAbove20SMA, pctAbove50SMA, pctAbove200SMA, pctBelow200SMA, ratio4_5, f10, f20, f50

### Step 4: Enhanced Regime Classifier
- [ ] `classifyRegimeFull()` returns complete `RegimeClassification` object
- [ ] 52WH/52WL downgrade works: BULL + bad 52W spread → CAUTIOUS
- [ ] Focus params correctly mapped for all 5 regime tiers (STRONG_BULL=7.5, BULL=8.0, CAUTIOUS=8.5, CHOPPY=9.0, BEAR=10.0)
- [ ] Config-driven thresholds: changing `emThresholds.bull` changes classification
- [ ] 4.5r interpretation: >300 "Strong day", 200-300 "OK day", <200 "Weak day"
- [ ] `generateFocusList()` respects `RegimeClassification.focusParams` when provided

### Step 5: CLI Integration
- [ ] `stark market` displays full MBI dashboard with EM bar, breadth, action recommendation
- [ ] `stark market` shows "Breadth-only mode" warning when EM unavailable
- [ ] `stark evening` fetches MBI BEFORE scoring and displays Mini MBI summary
- [ ] `stark evening` warns when regime is BEAR
- [ ] `stark morning` detects regime changes and displays UPGRADED/DOWNGRADED warning
- [ ] `CommandContext` includes `MBIDataManager`
- [ ] Format utilities in `packages/core/src/mbi/format.ts`

### Step 6: Analysis Scaffolding
- [ ] `stark mbi analyze` runs without error
- [ ] With <30 days of data: shows "need more data" message
- [ ] Pearson correlation returns correct values for known test data
- [ ] Linear regression returns correct coefficients for known test data
- [ ] Regime agreement percentage correctly computed
- [ ] Command registered in `stark.ts` router

### Global
- [ ] All existing 172 tests still pass
- [ ] ~38 new tests pass (~210 total)
- [ ] `bun run typecheck` passes (or `tsc --noEmit`)
- [ ] One commit per step (5 commits total)

## Verification Commands

```bash
cd /mnt/c/SteveTrading-mbi && bun test                    # ~210 pass, 3 pre-existing fail
cd /mnt/d/Projects/SteveTrading-mbi && bun run typecheck   # zero errors
```
