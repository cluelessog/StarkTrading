# Parallel Execution Plan: 3 Pending Plans via Git Worktrees

**Created:** 2026-03-11
**Status:** v2 — RALPLAN consensus APPROVED (Architect + Critic)
**Scope:** Execute `stark-mbi-integration.md`, `stark-logging-system.md`, and `stark-intraday-extensibility.md` in parallel using independent git worktrees
**Prerequisite:** All three plans must complete and merge before starting `plan-rpi-telegram.md`

---

## RALPLAN-DR Summary

### Guiding Principles

1. **Maximize true parallelism.** Each worktree must be able to proceed independently without blocking on another. Merge conflicts must be resolvable mechanically (no semantic conflicts).
2. **Merge order matters.** The plan that touches the most shared infrastructure merges first, so subsequent merges resolve against a stable base.
3. **Already-implemented code is the baseline.** The codebase already has partial implementations from all three plans (MBI models/schema/queries, basic Logger class, intraday schema seams). Plans describe remaining work, not greenfield.
4. **Smallest diff merges first.** When two plans have comparable conflict surface, the one with fewer lines changed merges first to minimize rebase complexity.

### Decision Drivers

1. **Conflict surface area:** Which files do multiple plans touch? How hard are the conflicts to resolve?
2. **Implementation completeness:** How much of each plan is already done? (Affects effort estimates and worktree scope.)
3. **Dependency ordering:** Does any plan's output serve as input to another plan's work?

### Viable Options

#### Option A: Fully Parallel (3 Worktrees) with Ordered Merge (RECOMMENDED)

**Approach:** Create 3 independent git worktrees, each branching from `master`. All three execute simultaneously. Merge in a specific order: Intraday (smallest) -> Logging -> MBI (largest). Each merge rebases against the updated master before merging.

**Pros:**
- Maximum parallelism -- all three execute simultaneously
- Merge order (small to large) minimizes conflict surface at each step
- Each worktree is fully independent -- no blocking
- The 3 plans touch almost entirely different files (analysis below)

**Cons:**
- 3 worktrees require 3 copies of node_modules (disk space)
- Merge step requires sequential attention (cannot be parallelized)
- If a plan discovers it needs changes in another plan's territory, coordination is needed

#### Option B: Two Parallel + One Sequential

**Approach:** Run MBI and Logging in parallel (largest two). After both merge, run Intraday sequentially (since it is the smallest and mostly adds seams to existing code).

**Pros:**
- Only 2 worktrees needed (less disk, less complexity)
- Intraday seams can be applied on top of merged MBI+Logging with zero conflict risk

**Cons:**
- Intraday is delayed unnecessarily -- it is independent and only takes ~1 hour
- No real benefit since Intraday conflicts are trivially resolvable
- Wastes wall-clock time for no reduction in merge complexity

**Invalidation rationale:** Intraday is so small (~1 hour of changes, mostly type widening and config additions) that sequentializing it provides zero benefit. Its conflict surface with MBI and Logging is effectively zero (see analysis below). Running it in parallel costs nothing.

---

## ADR: Architecture Decision Record

### Decision
Option A: Fully Parallel (3 worktrees) with ordered merge (Intraday -> Logging -> MBI).

### Drivers
- All three plans touch almost entirely disjoint file sets
- The only shared file (`packages/cli/bin/stark.ts`) has trivially resolvable conflicts (additive command registration)
- Wall-clock time is minimized by full parallelism
- Merge order (small to large) ensures each rebase is against a progressively more complete base

### Alternatives Considered
- Option B (Two parallel + one sequential): Rejected because Intraday is independent and delaying it provides no benefit

### Why Chosen
The conflict analysis (below) shows the three plans have near-zero file overlap. The one shared file (`stark.ts` CLI entry point) only needs additive changes (new command registration for `stark logs`). Full parallelism is safe and optimal.

### Consequences
- 3 git worktrees + 3 node_modules copies consume ~300-500MB additional disk
- Merge step is sequential and requires ~15-30 minutes of attention per merge
- If any plan fails tests, it blocks its own merge but not the other two

### Follow-ups
- After all 3 merge, run full test suite on master to verify no integration issues
- Clean up worktrees after merge
- Proceed to `plan-rpi-telegram.md`

---

## Conflict Analysis: File Overlap Between Plans

### File Touch Map

| File / Directory | MBI Plan | Logging Plan | Intraday Plan | Conflict Risk |
|---|---|---|---|---|
| `packages/core/src/db/schema.ts` | DONE (mbi_daily, market_context cols) | NO | DONE (trade_type, composite key) | NONE -- already implemented |
| `packages/core/src/db/queries.ts` | DONE (MBI queries) | NO | NO | NONE |
| `packages/core/src/config/index.ts` | DONE (emThresholds, sheetId) | NO | Seam 4 (risk config namespacing) -- DONE | NONE |
| `packages/core/src/models/market.ts` | DONE (MBIData, MBIRegime, etc.) | NO | NO | NONE |
| `packages/core/src/models/trade.ts` | NO | NO | DONE (TradeType) | NONE |
| `packages/core/src/log/logger.ts` | NO | MODIFY (enhance existing) | NO | NONE -- Logging-only |
| `packages/core/src/log/scoring-log.ts` | NO | MODIFY (add runId) | NO | NONE -- Logging-only |
| `packages/core/src/mbi/` | MODIFY (remaining steps) | NO | NO | NONE -- MBI-only |
| `packages/core/src/market/` | NEW (breadth-calculator, fallback) | NO | NO | NONE -- MBI-only |
| `packages/core/src/api/mbi-sheet.ts` | NEW (enhance from mbi/) | NO | NO | NONE -- MBI-only |
| `packages/core/src/api/chartink.ts` | NEW | NO | NO | NONE -- MBI-only |
| `packages/core/src/scoring/engine.ts` | NO | Step 3 (add runId to context) | NO | NONE -- Logging-only |
| `packages/core/src/scoring/context.ts` | NO | Step 3 (session_id = runId) | NO | NONE -- Logging-only |
| `packages/cli/bin/stark.ts` | NO | Step 2+5 (global flags, `logs` cmd) | NO | NONE -- Logging-only |
| `packages/cli/src/commands/market.ts` | Step 5 (MBI dashboard) | NO | NO | NONE -- MBI-only |
| `packages/cli/src/commands/evening.ts` | Step 5 (MBI fetch step) | Step 4 (state transitions) | NO | LOW -- different code sections |
| `packages/cli/src/commands/morning.ts` | Step 5 (MBI refresh) | Step 4 (state transitions) | NO | LOW -- different code sections |
| `packages/cli/src/commands/logs.ts` | NO | Step 5 (NEW file) | NO | NONE -- new file |
| `packages/cli/src/utils/command-context.ts` | NO | MODIFY (init logger, set runId) | NO | NONE -- Logging-only |
| `packages/core/src/cache/ohlcv-cache.ts` | NO | NO | Seam 2 (ALREADY DONE in models/intervals.ts) | NONE |

### Conflict Summary

**ZERO high-conflict files.** The only files touched by multiple plans are:
- `evening.ts` and `morning.ts`: MBI adds fetch steps, Logging adds state transition logging. These are **additive changes to different code sections** (MBI adds business logic, Logging wraps existing logic with log calls). Merge is mechanical.

**All schema, queries, config, and model changes are already implemented** on master. This dramatically reduces the conflict surface.

---

## What Remains Per Plan (Post-Codebase Analysis)

### MBI Integration (stark-mbi-integration.md)

**Already done:** Schema (mbi_daily table, market_context MBI columns), queries (upsertMBIDaily, getLatestMBI), models (MBIData, MBIRegime, BreadthData, EMThresholds, MarketContext), config (emThresholds, sheetId), sheet client (fetchMBIFromSheet in mbi/data-manager.ts), regime classifier (classifyRegime, classifyFromBreadth), focus list generator (generateFocusList), MBIDataManager basic implementation.

**Remaining work:**
1. **Step 2: Breadth Engine + Fallback** -- `packages/core/src/market/breadth-calculator.ts` (NEW), `packages/core/src/market/fallback-classifier.ts` (NEW). Self-calculated breadth from OHLCV, F10/F20/F50 oscillators, NIFTY 500 constituent list, bootstrap/cold-start logic.
2. **Step 3: Chartink Scraper** -- `packages/core/src/api/chartink.ts` (NEW). Raw breadth scraping as secondary fallback. Enhance MBIDataManager with 3-tier fallback chain (currently only Sheet + stale cache).
3. **Step 4: Enhanced Regime Classifier** -- 52WH/52WL downgrade logic, 4.5r integration, config-driven thresholds (partially done, needs enhancement).
4. **Step 5: CLI Integration** -- `stark market` MBI dashboard, `stark evening` MBI fetch step, `stark morning` MBI refresh + regime change warning.
5. **Step 6: Parallel Data Collection** -- `stark mbi analyze` command, regression analysis scaffolding.
6. **Tests** -- Unit tests for all new modules, integration tests for fallback chain.

**Estimated size:** LARGE (15-25 new/modified files, ~1500-2500 lines)

### Logging System (stark-logging-system.md)

**Already done:** Basic `Logger` class with JSONL file output, colored console output, correlation ID support, log rotation. `ScoringLog` class with append/read/rotate.

**Remaining work:**
1. **Step 1: Enhance Logger Core** -- Add `component` and `event` fields to LogEntry, add `child(component)` method for ComponentLogger, add `setRunId()`, add `runId` to all entries, add JSON.stringify safety wrapper. The existing Logger is ~60% of what the plan specifies.
2. **Step 2: CLI Flags** -- `--verbose`/`-v`, `--quiet`/`-q` global flags on `stark.ts`, `LOG_LEVEL` env var support, `logger.init()` call at CLI entry, runId generation per command.
3. **Step 3: ScoringContext Integration** -- Wire `ScoringContext.session_id` = `logger.runId`, batch_summary event logging, API client logger calls.
4. **Step 4: State Transition Logging** -- Workflow state logging in `evening.ts`, `morning.ts`, `review.ts`. Auth state logging.
5. **Step 5: `stark logs` Command** -- NEW `packages/cli/src/commands/logs.ts`, register in `stark.ts`.
6. **Tests** -- Unit tests for logger, integration tests for runId correlation.

**Estimated size:** MEDIUM (8-12 new/modified files, ~800-1200 lines)

### Intraday Extensibility (stark-intraday-extensibility.md)

**Already done:** Seam 1 (trade_type in schema + models), Seam 4 (risk config namespacing -- partially), Seam 7 (mbi_daily composite key).

**Remaining work:**
1. ~~**Seam 2: OHLCV Intervals**~~ -- ALREADY DONE. `OHLCVInterval` in `packages/core/src/models/intervals.ts` already includes `'1m' | '5m' | '15m' | '75m'`. No work needed.
2. **Seam 3: MBI Refresh Frequency** -- Add `refresh_interval` field to MBI config section. ~5 min.
3. **Seam 5: Sector Timestamps** -- Ensure `sector_money_flow.captured_at` uses datetime (already does -- verify). ~5 min.
4. **Seam 6: Analytics Filter** -- Add `trade_type` filter to performance queries when they are built. This is a Phase 3 concern -- may only need a placeholder/TODO now.
5. **Verification** -- Confirm all 7 seams are in place, write verification checklist.

**Estimated size:** SMALL (3-5 modified files, ~50-100 lines of actual changes)

---

## Implementation Plan

### Worktree Setup

```bash
# From /mnt/d/Projects/SteveTrading (main repo)

# Worktree 1: MBI Integration
git worktree add ../SteveTrading-mbi feat/mbi-integration

# Worktree 2: Logging System
git worktree add ../SteveTrading-logging feat/logging-system

# Worktree 3: Intraday Extensibility
git worktree add ../SteveTrading-intraday feat/intraday-seams
```

Each worktree branches from current `master` and works independently.

### Per-Worktree Scope

#### Worktree 1: `feat/mbi-integration` (LARGE)

**Files to create:**
- `packages/core/src/market/breadth-calculator.ts`
- `packages/core/src/market/fallback-classifier.ts`
- `packages/core/src/market/index.ts`
- `packages/core/src/api/chartink.ts`
- `packages/cli/src/commands/mbi-analyze.ts` (or inline in market.ts)

**Files to modify:**
- `packages/core/src/mbi/data-manager.ts` -- Add 3-tier fallback (Sheet -> Chartink -> breadth-only)
- `packages/core/src/mbi/regime-classifier.ts` -- Add 52WH/52WL downgrade logic, config-driven thresholds
- `packages/core/src/mbi/index.ts` -- Re-export new modules
- `packages/core/src/api/index.ts` -- Export chartink client
- `packages/cli/src/commands/market.ts` -- MBI dashboard display
- `packages/cli/src/commands/evening.ts` -- MBI fetch step (additive)
- `packages/cli/src/commands/morning.ts` -- MBI refresh + regime warning (additive)

**Tests:**
- `packages/core/src/mbi/__tests__/regime-classifier.test.ts`
- `packages/core/src/market/__tests__/breadth-calculator.test.ts`
- `packages/core/src/market/__tests__/fallback-classifier.test.ts`
- `packages/core/src/mbi/__tests__/data-manager.test.ts`

**Acceptance Criteria:**
- Breadth calculator produces breadth percentages from OHLCV data
- 3-tier fallback: Sheet -> Chartink -> breadth-only works end-to-end
- EM-based regime classifier handles boundary values correctly
- 52WH/52WL downgrade logic works in both EM and breadth-only paths
- `stark market` displays MBI dashboard
- `stark evening` fetches MBI before scoring
- All new tests pass

#### Worktree 2: `feat/logging-system` (MEDIUM)

**Files to create:**
- `packages/cli/src/commands/logs.ts`

**Files to modify:**
- `packages/core/src/log/logger.ts` -- Enhance with component, event, runId, child(), JSON safety
- `packages/core/src/log/index.ts` -- Update exports
- `packages/core/src/scoring/context.ts` -- Wire session_id = runId
- `packages/cli/bin/stark.ts` -- Add --verbose/--quiet flags, register `logs` command, init logger
- `packages/cli/src/utils/command-context.ts` -- Initialize logger + set runId in factory
- `packages/cli/src/commands/evening.ts` -- Add state transition logging (additive)
- `packages/cli/src/commands/morning.ts` -- Add state transition logging (additive)

**Tests:**
- `packages/core/src/log/__tests__/logger.test.ts`
- `packages/core/src/log/__tests__/scoring-log.test.ts`

**Acceptance Criteria:**
- Logger writes JSONL with ts, level, runId, component, event, msg fields
- `child(component)` returns ComponentLogger with fixed prefix
- Console output respects --verbose/--quiet/LOG_LEVEL
- `stark logs --errors` and `stark logs --run <id>` work
- ScoringContext.session_id matches logger.runId
- State transitions logged in evening/morning workflows
- Log rotation deletes files older than 14 days

#### Worktree 3: `feat/intraday-seams` (SMALL)

**Files to modify:**
- `packages/core/src/cache/ohlcv-cache.ts` (or wherever OHLCVInterval is defined) -- Seam 2: widen interval type
- `packages/core/src/config/index.ts` -- Seam 3: add `mbiRefreshInterval` field (if not already present)
- Verify `sector_money_flow.captured_at` uses datetime -- Seam 5 (already done in schema)
- Add TODO comments for Seam 6 (trade_type filter in performance queries -- Phase 3)

**Tests:**
- Verification script/checklist confirming all 7 seams are in place
- Type compilation check (ensure widened types compile)

**Acceptance Criteria:**
- `OHLCVInterval` type includes `'1m' | '5m' | '15m'` (VERIFIED: already present in `models/intervals.ts`)
- MBI config has `refreshInterval` field (default: `'daily'`)
- All 7 seams documented and verified present in codebase
- No intraday-specific code exists (only seams/types/config)
- `bun run typecheck` passes

---

### Merge Order and Strategy

```
Phase 1: All 3 worktrees execute in parallel
         |
         v
Phase 2: Sequential merge (after all 3 complete)

  Step 1: Merge feat/intraday-seams -> master
          (Smallest diff, zero conflict risk)
          Run: bun test
          |
          v
  Step 2: Rebase feat/logging-system onto updated master
          Merge feat/logging-system -> master
          (Medium diff, may need trivial conflict resolution in evening.ts/morning.ts)
          Run: bun test
          |
          v
  Step 3: Rebase feat/mbi-integration onto updated master
          Merge feat/mbi-integration -> master
          (Largest diff, may need conflict resolution in evening.ts/morning.ts
           where logging state transitions were added in Step 2)
          Run: bun test (full suite)
          |
          v
Phase 3: Post-merge verification
          Run full test suite on master
          Clean up worktrees: git worktree remove ../SteveTrading-*
```

### Merge Conflict Resolution Guide

**`evening.ts` / `morning.ts` (MBI + Logging both modify):**
- Logging adds `logger.info('workflow', 'state_change', ...)` wrapper calls around existing code
- MBI adds new business logic blocks (MBI fetch, regime check)
- Resolution: Keep both -- logging wraps the workflow steps, MBI adds new steps within the workflow. These are additive changes to different sections. Accept both hunks.

**`packages/cli/bin/stark.ts` (Logging adds flags + command):**
- Only Logging modifies this file. No conflict with other plans.
- MBI commands (`market`, `evening`, `morning`) are already registered.

**`packages/core/src/config/index.ts` (Intraday adds config field):**
- Only Intraday modifies this file in remaining work (adding `mbiRefreshInterval`).
- MBI config fields (`emThresholds`, `sheetId`) are already on master.
- No conflict.

---

## Execution Coordination

### Parallel Agents

| Agent | Worktree | Branch | Plan | Est. Time |
|---|---|---|---|---|
| Agent 1 | `../SteveTrading-mbi` | `feat/mbi-integration` | stark-mbi-integration.md (remaining Steps 2-6) | 3-5 hours |
| Agent 2 | `../SteveTrading-logging` | `feat/logging-system` | stark-logging-system.md (remaining Steps 1-5) | 2-3 hours |
| Agent 3 | `../SteveTrading-intraday` | `feat/intraday-seams` | stark-intraday-extensibility.md (remaining Seams 2,3,5,6) | 30-60 min |

### Test Strategy Per Worktree

Each worktree must:
1. Copy changed files to its own `/mnt/c/` test directory (not shared!) before running tests:
   - MBI worktree → `/mnt/c/SteveTrading-mbi/`
   - Logging worktree → `/mnt/c/SteveTrading-logging/`
   - Intraday worktree → `/mnt/c/SteveTrading-intraday/`
   This prevents parallel agents from overwriting each other's test files.
2. Run `bun test` for unit tests
3. Run `bun run typecheck` for type verification
4. Verify no regressions in the 172 passing tests (3 pre-existing failures in ohlcv-cache.test.ts are known/accepted)

### Post-Merge Verification

After all 3 branches merge to master:
1. Full `bun test` -- expect 172+ passing, 3 pre-existing failures
2. `bun run typecheck` -- zero errors
3. Manual smoke test: `stark market`, `stark evening --help`, `stark logs --help`
4. Verify MBI + Logging integration: evening workflow should both fetch MBI AND log state transitions
5. **Post-merge integration pass:** Add logging wrappers (`logger.info('workflow', 'state_change', ...)`) to MBI-added workflow steps in `evening.ts` and `morning.ts` that were merged without logging instrumentation (MBI agent adds business logic at fork time; Logging agent only wraps code that existed at fork time)

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| evening.ts/morning.ts merge conflict (MBI + Logging) | MEDIUM | LOW | Additive changes to different sections; mechanical resolution. Document which sections each plan touches. |
| Worktree disk space on exFAT | LOW | LOW | Each worktree is ~50MB + node_modules. exFAT supports it fine. |
| Agent discovers cross-plan dependency mid-execution | LOW | MEDIUM | Each agent has clear file boundaries. If boundary violation needed, pause and coordinate. |
| MBI plan takes longer than expected (largest scope) | MEDIUM | LOW | Logging and Intraday merge independently. MBI can take extra time without blocking others. |
| Test failures after final merge | LOW | MEDIUM | Run tests after EACH merge step, not just at the end. Fix before proceeding to next merge. |

---

## Success Criteria

1. All 3 feature branches created and execute in parallel
2. Each branch passes its own tests independently
3. All 3 branches merge to master without semantic conflicts
4. Post-merge master passes full test suite (172+ pass, 3 pre-existing fail)
5. `stark market` shows MBI dashboard with regime classification
6. `stark evening --verbose` shows DEBUG-level logging with state transitions
7. All 7 intraday seams verified present via checklist
8. Worktrees cleaned up after successful merge
9. Ready to proceed to `plan-rpi-telegram.md`

---

## Consensus Record

**Planner v1:** Created 3-worktree parallel plan with ordered merge strategy.

**Architect Review:** APPROVED with 5 suggestions:
1. Add `command-context.ts` to Logging file touch map *(incorporated)*
2. Mark Intraday Seam 2 as already complete *(incorporated)*
3. `/mnt/c/` test copy isolation — 3 separate directories *(incorporated — MANDATORY)*
4. Post-merge integration task — add logging to MBI steps *(incorporated — MANDATORY)*
5. Update test count from 159 to 172 *(incorporated)*

**Critic Evaluation:** APPROVED with 2 mandatory amendments (items 3 and 4 above) and 2 recommended fixes (items 2 and 5). All incorporated into v2.

**Key Tradeoffs Acknowledged:**
- Parallelism saves ~2-3 hours wall-clock but adds merge coordination overhead. For agent-driven execution, coordination cost is low enough to justify.
- Mechanical merge of `evening.ts`/`morning.ts` produces correct but unlogged MBI steps. Post-merge integration pass (Step 5 of Post-Merge Verification) addresses this.

**Final Status:** v2 — CONSENSUS APPROVED
