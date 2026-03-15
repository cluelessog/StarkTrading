# Code Audit Fixes -- Deliberate RALPLAN-DR Plan

**Date:** 2026-03-15
**Source:** `docs/code-audit-findings-2026-03-15.md` (9 findings, CRITICAL to MEDIUM)
**Mode:** DELIBERATE (live trading system, fail-safe correctness required)
**Execution:** Sequential phases, one worktree at a time, each phase independently shippable

---

## RALPLAN-DR Summary

### Principles (5)

1. **Fail closed, never fail open.** A trading system that silently degrades to fake data is worse than one that crashes. Every fallback must be explicit, loud, and operator-approved.
2. **Scores must reflect reality.** If a human has not reviewed discretionary factors, the score status must say so. Downstream consumers must never promote unreviewed names.
3. **Persistence is truth.** If the CLI tells the operator "saved", the database row must be internally consistent -- totals, breakdown JSON, status, and timestamps all atomically correct.
4. **Risk controls block, not log.** Position sizing and heat limits must reject or resize before insertion, not warn after the fact.
5. **One path, one truth.** All consumers of focus lists, scoring, and trade entry must route through the same shared logic. No duplicated SQL that sidesteps regime-aware thresholds.

### Decision Drivers (top 3)

1. **Data source integrity** -- The system must never score, trade, or report on synthetic mock data without explicit operator consent. This is the single highest-risk issue.
2. **Score lifecycle correctness** -- The PARTIAL -> COMPLETE workflow is the backbone of the trading decision pipeline. Getting this wrong means the focus list, entry decisions, and performance analytics all consume garbage.
3. **Trade record durability** -- Fabricated exits, advisory-only risk controls, and inconsistent review persistence all corrupt the trade journal, which is the only source of truth for performance analytics and factor-edge analysis.

### Viable Options

#### Option A: Sequential Phase Fix (CHOSEN)

Fix in strict dependency order: auth -> scoring workflow -> review persistence -> token resolution -> sync exits -> risk enforcement -> consumer alignment -> telegram stubs -> config wiring.

| Pros | Cons |
|------|------|
| Each phase is independently shippable and testable | Slower wall-clock time vs parallel |
| No merge conflicts between phases | Later phases blocked until earlier ones ship |
| Matches natural dependency graph | -- |
| Simplest mental model for a solo operator | -- |

#### Option B: Parallel Tracks

Split into "data integrity" (auth, scoring, sync) and "safety enforcement" (risk, config, dead code) tracks running in two worktrees concurrently.

| Pros | Cons |
|------|------|
| Faster wall-clock delivery | Merge conflicts between tracks touching shared files (queries.ts, engine.ts, config/index.ts) |
| -- | Risk track depends on scoring workflow changes for correct heat calculation |
| -- | Two worktrees means two sets of test runs, harder to verify combined correctness |

**Invalidation rationale:** Option B was rejected because `entry.ts` (risk enforcement) depends on the scoring workflow changes from the scoring phase, and `portfolio-heat.ts` depends on correct trade records from the sync phase. The dependency graph is linear, not parallel. Forcing parallelism creates merge hazards in a live trading system where correctness matters more than speed.

### Pre-mortem (3 failure scenarios)

1. **Auth fix breaks development workflow.** Removing MockProvider fallback means developers without Angel One credentials cannot run any CLI command. **Mitigation:** Gate mock mode behind an explicit `STARK_MOCK=1` env var or `--mock` CLI flag, with loud banners. Keep MockProvider alive for tests. Never auto-fallback in production paths.

2. **PARTIAL status breaks existing focus lists.** If batch scoring now produces `status='PARTIAL'` instead of `'COMPLETE'`, all downstream consumers that filter on `WHERE status = 'COMPLETE'` will return zero results until review is done. **Mitigation:** Phase 2 adds `includePartial?: boolean` to `generateFocusList()` (default `false`). Morning workflows default to reviewed-only (safe). Operators can use `stark focus --include-unreviewed` to see unreviewed candidates. The PARTIAL status only applies when semi-discretionary factors are registered but unreviewed.

3. **Review persistence migration corrupts existing scores.** Changing the review UPDATE statement to touch all 13 factor columns could overwrite valid algorithmic scores with stale values if the review UI reads from `score_breakdown_json` instead of live columns. **Mitigation:** Phase 3 must always read from individual factor columns (the canonical source), never from the JSON blob, when populating the review form. The JSON blob is rebuilt from columns, not the other way around.

### Expanded Test Plan

#### Unit Tests
- `session-manager.test.ts`: Test that `ensureAuthenticated` passes `clientcode` + `password` + `totp` (not `clientId`). Test that missing password throws, not falls back. Test that `STARK_MOCK=1` produces MockProvider with warning.
- `scoring-engine.test.ts`: Test that batch scoring with 6 semi-discretionary factors (including `pattern_quality`) produces `status='PARTIAL'`. Test that `scoreSymbol` separates 7 algorithmic vs 6 semi-discretionary score buckets correctly.
- `trade-manager.test.ts`: Test that `entry()` rejects when `riskAmount > riskPerTrade`. Test that `entry()` rejects when portfolio heat exceeds alert level.
- `portfolio-sync.test.ts`: Test that missing broker positions are marked `UNRESOLVED`, not auto-closed at entry price.
- `focus-list.test.ts`: Test that focus list respects regime thresholds from config, not hardcoded values. Test that `includePartial: false` (default) excludes PARTIAL scores. Test that `includePartial: true` includes PARTIAL scores.

#### Integration Tests
- `review-workflow.test.ts` (new): End-to-end review flow: score batch -> verify PARTIAL -> review with overrides -> verify COMPLETE with consistent breakdown JSON + totals + status.
- `auth-to-scoring.test.ts` (new): Full path from config load -> session manager -> provider selection -> single-symbol scoring with real token resolution.
- `entry-risk-gate.test.ts` (new): Entry command with risk exceeding limit -> verify rejection. Entry with heat at warning -> verify warning. Entry with heat at alert -> verify block.

#### E2E Tests
- `evening-to-morning.test.ts` (new): Evening batch score -> review -> morning focus list. Verify focus list only contains COMPLETE+reviewed stocks above regime threshold. Verify `--include-unreviewed` shows PARTIAL stocks. Verify default (no flag) excludes PARTIAL.

#### Observability
- All auth fallbacks must emit `logger.warn` with `action='auth_fallback'` and `provider='mock'`.
- All risk rejections must emit `logger.warn` with `action='risk_rejection'` and include the computed vs allowed values.
- Portfolio sync unresolved trades must emit `logger.warn` with `action='sync_unresolved'`.
- Review finalization must emit `logger.info` with `action='review_finalized'` and the delta between old and new scores.

---

## Context

The code audit found 9 issues (1 CRITICAL, 5 HIGH, 3 MEDIUM) across auth, scoring, review, trade management, and consumer alignment. All 321 existing tests pass, meaning the tests encode the current (incorrect) behavior and must be updated alongside the fixes.

## Work Objectives

Fix all 9 audit findings in strict dependency order across 5 phases, each independently shippable and testable. Update existing tests that encode wrong behavior. Add new tests for previously untested correctness invariants.

## Guardrails

### Must Have
- Every phase ships with updated/new tests that verify the fix
- MockProvider remains available for test suites (in-memory SQLite + mock data)
- All changes in worktrees, never directly on master
- Each phase merged to master only after all tests pass

### Must NOT Have
- Silent fallback to mock data in any production CLI path
- Auto-closing trades at fabricated exit prices
- Advisory-only risk controls that warn after insertion
- Duplicated focus-list SQL that bypasses regime thresholds
- Telegram tools that acknowledge mutations without persisting them

---

## Task Flow

```
Phase 1 (Auth)
  |
  v
Phase 2 (Scoring Workflow)
  |
  v
Phase 3 (Review Persistence + Token Resolution)
  |
  v
Phase 4 (Sync Exits + Risk Enforcement)
  |
  v
Phase 5 (Consumer Alignment + Telegram + Config Wiring)
```

---

## Phase 1: Auth -- Fail Closed on Broker Authentication

**Worktree:** `audit-phase1-auth`
**Finding:** #1 (CRITICAL)
**Files:** 4 files, ~80 lines changed

### TODO 1.1: Fix credential plumbing in SessionManager

**File:** `packages/core/src/auth/session-manager.ts` (lines 38-71)

- Line 53-56: Change `{ clientId: config.angelOne.clientId, totp }` to `{ clientcode: config.angelOne.clientId, password: config.angelOne.password, totp }`
- The `authenticate()` call currently passes `clientId` (wrong key name) and omits `password` entirely
- `AngelOneProvider.authenticate()` at `packages/core/src/api/angel-one.ts:83` destructures `{ clientcode, password, totp }` -- the keys must match

**Acceptance:** `provider.authenticate()` receives all three required fields. Auth succeeds when credentials are valid. Auth throws `DataProviderError('auth_expired', ...)` when any field is missing.

### TODO 1.2: Add `password` field to AngelOneConfig

**File:** `packages/core/src/config/index.ts` (lines 44-48)

- Add `password?: string` to the `AngelOneConfig` interface alongside existing `apiKey`, `clientId`, `totpSecret`

**Acceptance:** `StarkConfig.angelOne.password` is a valid config field. `loadConfig()` reads it from `~/.stark/config.json`.

### TODO 1.3: Remove silent MockProvider fallback from production paths

**File:** `packages/core/src/auth/session-manager.ts` (lines 62-70)

- Remove the catch block that silently falls back to MockProvider
- Remove the final MockProvider fallback at lines 68-70
- Instead, throw a clear error: `'Broker authentication failed. Run stark auth or check ~/.stark/config.json. To use mock data for development, set STARK_MOCK=1'`
- Add a new explicit mock gate at the top of `ensureAuthenticated`: if `process.env.STARK_MOCK === '1'`, return MockProvider with a loud `console.warn('[MOCK MODE] ...')` banner

**Acceptance:** Without `STARK_MOCK=1`, auth failure throws instead of silently degrading. With `STARK_MOCK=1`, MockProvider is returned with visible warning. No production workflow can silently run on fake data.

### TODO 1.4: Update session-manager tests

**File:** `packages/core/tests/session-manager.test.ts`

- Update existing tests that expect MockProvider fallback on auth failure
- Add test: missing password in config -> throws error (not fallback)
- Add test: `STARK_MOCK=1` -> returns MockProvider with warning
- Add test: valid credentials -> passes `clientcode`, `password`, `totp` to `authenticate()`

**Acceptance:** All session-manager tests pass. No test expects silent mock fallback.

---

## Phase 2: Scoring Workflow -- PARTIAL/COMPLETE Lifecycle

**Worktree:** `audit-phase2-scoring`
**Finding:** #2 (HIGH)
**Files:** 5 files, ~90 lines changed

### TODO 2.1: Separate auto-scored factors from review-pending factors in ScoringEngine

**File:** `packages/core/src/scoring/engine.ts` (lines 124-178)

- Line 124: `getAlgorithmic()` currently returns both `algorithmic` and `semi-discretionary` factors. This is correct for the automated pass -- semi-discretionary factors have algorithmic pre-filters that run without LLM.
- Line 128: The `semiDiscretionaryIds` set is currently `['linearity', 'not_pivot_cutter', 'aoi', 'hve_hvy', 'hvq_2_5']` (5 IDs). This is **missing `pattern_quality`**. The registry correctly marks `pattern_quality` as `semi-discretionary` (registry.ts line 202) because it involves visual chart assessment (VCP pattern recognition). Add `'pattern_quality'` to the set, making it 6 semi-discretionary IDs: `['linearity', 'not_pivot_cutter', 'aoi', 'hve_hvy', 'hvq_2_5', 'pattern_quality']`. This changes the factor split from "8 algorithmic + 5 semi-discretionary" to **7 algorithmic + 6 semi-discretionary**.
- Lines 177-178: The status determination is wrong. Currently: `allFactorsScored ? 'COMPLETE' : 'PARTIAL'`. Change to: status is `'PARTIAL'` when any semi-discretionary factor was scored by algorithm (not reviewed by human). Since batch scoring never involves human review, batch scoring should always produce `'PARTIAL'` when semi-discretionary factors are enabled.
- Add a `reviewedFactorIds?: Set<string>` parameter to `scoreSymbol` so the engine can distinguish "scored by algorithm" from "confirmed by human review."
- Default behavior (no reviewedFactorIds): semi-discretionary factors score algorithmically, status = `'PARTIAL'`
- With reviewedFactorIds: factors in the set are marked as reviewed, status = `'COMPLETE'` only when all semi-discretionary factors are in the reviewed set

**Acceptance:** `scoreBatch()` produces `status='PARTIAL'` for all stocks. `scoreSymbol()` with `reviewedFactorIds` covering all semi-discretionary IDs produces `status='COMPLETE'`. The `ScoreResult.status` field accurately reflects whether human review has occurred.

### TODO 2.2: Update scoring engine tests

**File:** `packages/core/tests/scoring-engine.test.ts`

- Update tests that assert `status: 'COMPLETE'` after batch scoring to assert `status: 'PARTIAL'`
- Add test: batch scoring with 6 semi-discretionary factors enabled -> all results have `status='PARTIAL'`
- Add test: `scoreSymbol` with full `reviewedFactorIds` (all 6 semi-discretionary IDs) -> `status='COMPLETE'`
- Add test: `pattern_quality` is in `semiDiscretionaryIds` and contributes to discretionary score bucket

**File:** `packages/core/tests/llm-integration.test.ts`

- Update any tests that assume COMPLETE status after automated LLM scoring

**Acceptance:** All scoring tests pass with corrected status expectations.

### TODO 2.3: Add `includePartial` option to `generateFocusList()`

**File:** `packages/core/src/mbi/focus-list.ts` (lines 50-93)

- Add an optional parameter `includePartial?: boolean` (default `false`) to `generateFocusList()`.
- Line 76: The current SQL filter is `WHERE status = 'COMPLETE'`. When `includePartial` is `true`, change to `WHERE status IN ('COMPLETE', 'PARTIAL')`. Default remains `COMPLETE`-only, preserving the safety-first principle that morning focus lists only show reviewed stocks.
- This prevents the review bottleneck: if the operator has not reviewed scores yet, they can still see unreviewed candidates by explicitly opting in, rather than getting an empty focus list.

**File:** `packages/cli/src/commands/focus.ts` (or `morning.ts` if focus is part of morning)

- Add `--include-unreviewed` flag. When set, pass `includePartial: true` to `generateFocusList()`.
- Default behavior (no flag): only COMPLETE (reviewed) stocks appear, same as before.

**Acceptance:** `stark focus` returns only COMPLETE stocks. `stark focus --include-unreviewed` includes PARTIAL stocks too. `generateFocusList(db, regime, registry)` without the option returns COMPLETE-only. `generateFocusList(db, regime, registry, { includePartial: true })` includes PARTIAL.

### TODO 2.4: Update score insertion to persist PARTIAL status

**File:** `packages/core/src/scoring/engine.ts` (lines 197-244, `scoreBatch`)

- Line 217: `status: result.status` -- this already passes through the status from `scoreSymbol`. No change needed here, but verify it correctly persists `'PARTIAL'` after TODO 2.1.

**File:** `packages/core/src/db/queries.ts` (lines 502-552, `insertStockScore`)

- Verify that the INSERT uses the `data.status` value (it does at line 519). No code change, just verification.

**Acceptance:** After `scoreBatch()`, database rows have `status='PARTIAL'`. Verified by querying `SELECT status FROM stock_scores` in tests.

---

## Phase 3: Review Persistence + Token Resolution

**Worktree:** `audit-phase3-review-token`
**Findings:** #3 (HIGH) + #6 (HIGH)
**Files:** 4 files, ~120 lines changed

### TODO 3.1: Fix review command to drive queue from stored status

**File:** `packages/cli/src/commands/review.ts` (lines 20-51)

- Line 43-51: Replace the current query. Change `WHERE total_score >= 3` to `WHERE status = 'PARTIAL'`. Remove the `total_score >= 3` filter -- the review queue should show all stocks pending human review, not an arbitrary score cutoff.
- Line 72: Remove the inferred status logic `c.discretionary_score > 0 ? 'COMPLETE' : 'PARTIAL'`. Use the actual `status` column from the database.
- Add `status` to the SELECT columns.

**Acceptance:** Review queue only shows stocks with `status='PARTIAL'`. Stocks already reviewed (status='COMPLETE') do not appear.

### TODO 3.2: Always finalize reviewed rows, even with no overrides

**File:** `packages/cli/src/commands/review.ts` (lines 160-193)

- Lines 160-193: Currently, the UPDATE only runs when `overrideCount > 0`. Change to always run the UPDATE after review, regardless of whether overrides were made.
- Expand the UPDATE to persist all 13 factor columns (not just the 6 semi-discretionary ones at lines 163-168). The 7 algorithmic factors (`ep_catalyst`, `sector_strength`, `high_rs`, `ipo_recency`, `thrust_power`, `pivot_location`, `pivot_level_proximity`) and 6 semi-discretionary factors (`linearity`, `not_pivot_cutter`, `aoi`, `hve_hvy`, `hvq_2_5`, `pattern_quality`) must all be included in the SET clause, reading from `factorUpdates[id] ?? stock[column] ?? 0`.
- Rebuild `score_breakdown_json` from the final factor values and include it in the UPDATE.
- Set `status = 'COMPLETE'`, `reviewed_at = datetime('now')`, `override_count = ?` in every case.
- Log the finalization: `logger.info('workflow', 'review_finalized', ...)`.

**Acceptance:** After reviewing a stock (even with zero overrides): `status='COMPLETE'`, `reviewed_at` is set, `score_breakdown_json` is consistent with individual factor columns, `total_score` matches sum of factor values.

### TODO 3.3: Fix single-symbol token resolution

**File:** `packages/cli/src/commands/score.ts` (lines 18-33)

- Line 20: `const token = '0'` is a placeholder that never gets resolved. Replace with actual token resolution:
  1. First, check watchlist: `queries.getWatchlistStocks(1, 0)` and find matching symbol
  2. If not in watchlist, use `provider.searchSymbol(symbolArg)` to resolve from instrument master
  3. If neither works, fail with clear error: `'Could not resolve token for ${symbolArg}. Add to watchlist or check symbol name.'`

**File:** `packages/telegram/src/executor.ts` (line 19)

- Same fix: the Telegram `score` tool also uses `'0'` as token. Apply the same resolution logic, using `ctx.queries` and `ctx.provider.searchSymbol()`.

**Acceptance:** `stark score RELIANCE` resolves token `'2885'` from watchlist or instrument master. `stark score FAKESYMBOL` fails with a clear error message. Telegram score tool resolves tokens identically.

### TODO 3.4: Add tests for token resolution and review persistence

- New test file or extend `packages/core/tests/scoring-engine.test.ts`: single-symbol scoring with resolved token produces valid results.
- New test in review tests: review with no overrides still sets `status='COMPLETE'` and `reviewed_at`.
- New test: review with overrides produces consistent `score_breakdown_json`.

**Acceptance:** All new tests pass.

---

## Phase 4: Sync Exits + Risk Enforcement

**Worktree:** `audit-phase4-sync-risk`
**Findings:** #5 (HIGH) + #4 (HIGH)
**Files:** 5 files, ~120 lines changed

### TODO 4.1: Fix portfolio sync to not fabricate exit prices

**File:** `packages/core/src/journal/portfolio-sync.ts` (lines 59-76)

- Lines 61-63: The current code searches `positions` for a symbol it already proved is NOT in `positions` (line 61: `!brokerSymbols.has(trade.symbol)`). Then line 63 falls back to `trade.entryPrice` as exit price, creating a zero-P&L fabricated exit.
- Replace auto-exit with an `UNRESOLVED` marking:
  1. Add a new method `queries.markTradeUnresolved(tradeId)` that sets a `status='UNRESOLVED'` or adds a flag column.
  2. Alternatively (simpler, no schema change): add the trade to `result.warnings` with details, and do NOT call `tradeManager.exit()`. The trade stays OPEN until the operator manually reconciles.
  3. Log: `queries.insertAutomationLog('sync_unresolved', 'skipped', ...)`.
- Remove the `tradeManager.exit()` call for missing positions entirely.

**Acceptance:** When a broker position disappears, the Stark trade remains OPEN with a warning logged. No fabricated exit at entry price. The `result.warnings` array contains the unresolved symbol. The `result.autoExits` array is empty for missing positions.

### TODO 4.2: Update portfolio-sync tests

**File:** `packages/core/tests/portfolio-sync.test.ts`

- Update tests that expect auto-exit behavior to expect warnings instead.
- Add test: broker position missing -> trade stays OPEN, warning emitted.
- Add test: no fabricated P&L in autoExits.

**Acceptance:** All portfolio-sync tests pass with corrected expectations.

### TODO 4.3: Enforce risk controls before trade insertion

**File:** `packages/core/src/journal/trade-manager.ts` (lines 4-12, `EntryInput`; lines 51-98, `entry()`)

- Lines 4-12: Add `riskProfile: RiskProfile` as a **required** field on `EntryInput` (not optional). This ensures no caller can silently bypass risk controls. Also add `force?: boolean` for explicit override.
- After line 63 (risk calculation), before line 65 (data construction), add risk enforcement:
  1. Check `riskAmount > riskProfile.riskPerTrade` -> throw `'Trade risk Rs ${riskAmount} exceeds per-trade limit Rs ${riskProfile.riskPerTrade}. Use --force to override.'`
  2. Compute portfolio heat using existing `calculatePortfolioHeat()` and check against `riskProfile.heatAlert` -> throw if breached
  3. If `force === true`, log a warning but allow the trade through

**File:** `packages/cli/src/commands/entry.ts` (lines 63-71)

- Line 64: Pass `riskProfile: config.risk.swing` (or `config.risk.intraday` based on trade type) to `manager.entry()`. This is now required, not optional.
- Line 74: Move heat calculation BEFORE the entry call (currently after at line 74). Show recommended max shares based on risk limit.
- Add `--force` flag parsing to allow operator override.

**File:** `packages/telegram/src/executor.ts` (line 255, entry tool)

- Line 255: The Telegram entry tool calls `tradeManager.entry({ symbol, entryPrice, shares, stopPrice, conviction })`. Update to also pass `riskProfile: ctx.config.risk.swing` (or determine trade type from context). This is now required since `riskProfile` is mandatory on `EntryInput`. Without this change, the Telegram entry tool will fail at compile time.

**Acceptance:** `stark entry RELIANCE --price 2850 --shares 10000 --stop 2780` with default risk config rejects the trade. `--force` overrides the rejection. Heat is checked before insertion, not after. Telegram entry tool also enforces risk limits identically. No caller of `tradeManager.entry()` can omit `riskProfile`.

### TODO 4.4: Add risk enforcement tests

**File:** `packages/core/tests/trade-manager.test.ts`

- Add test: entry with risk exceeding `riskPerTrade` -> throws error
- Add test: entry with `force: true` and excessive risk -> succeeds with warning logged
- Add test: entry when portfolio heat exceeds alert -> throws error
- Add test: entry without `riskProfile` -> TypeScript compile error (field is required)
- Add test: Telegram entry tool passes `riskProfile` and respects risk limits

**Acceptance:** All trade-manager tests pass including new risk enforcement tests. No caller of `entry()` compiles without providing `riskProfile`.

---

## Phase 5: Consumer Alignment + Telegram + Config Wiring

**Worktree:** `audit-phase5-consumers`
**Findings:** #7 (MEDIUM) + #8 (MEDIUM) + #9 (MEDIUM)
**Files:** 6 files, ~80 lines changed

### TODO 5.1: Route all focus-list consumers through shared generator

**File:** `packages/cli/src/commands/morning.ts` (lines 44-52)

- Lines 44-52: Replace the raw SQL `SELECT symbol, token, total_score FROM stock_scores WHERE status = 'COMPLETE' ORDER BY total_score DESC LIMIT 5` with a call to `generateFocusList(db, regime, registry)` from `packages/core/src/mbi/focus-list.ts`.
- This requires knowing the current regime, which is already fetched at lines 12-41.

**File:** `packages/cli/src/commands/cron-start.ts` (lines 79-81)

- Lines 79-81: Same raw SQL bypass in `onMorning()`. Replace with `generateFocusList()`.

**File:** `packages/telegram/src/executor.ts` (lines 40-46, focus tool; lines 109-111, morning tool)

- Lines 40-46: Replace raw SQL with `generateFocusList()`.
- Lines 109-111: Same replacement in morning tool.

**Acceptance:** All consumers produce identical focus lists for the same regime. No raw SQL queries for focus stocks outside of `focus-list.ts`. In BEAR regime, focus list returns 0 stocks (not top-5 regardless of regime).

### TODO 5.2: Mark Telegram mutation tools as stubs

**File:** `packages/telegram/src/executor.ts` (lines 151-162, review tool; lines 227-269, entry tool; lines 272-313, exit tool)

- The review tool at line 160 returns `'Override queued: ...'` but does not persist anything.
- The entry and exit tools at lines 254-268 and 290-312 DO call `tradeManager.entry()` and `tradeManager.exit()` respectively -- these actually persist. **Correction from audit finding #8:** entry and exit tools ARE wired to TradeManager. Only the review tool is a stub.
- For the review tool: change the summary to explicitly state `'[NOT PERSISTED] Override noted but not saved. Use CLI: stark review --symbol=SYMBOL'`. This makes the non-persistence visible to the operator.

**Acceptance:** Telegram review tool clearly communicates that overrides are not persisted. No false acknowledgement of saved data.

### TODO 5.3: Wire config scoring thresholds into focus-list runtime

**File:** `packages/core/src/mbi/focus-list.ts` (lines 30-44)

- Lines 30-36: `BASE_THRESHOLDS` is hardcoded. Accept an optional `ScoringConfig` parameter in `generateFocusList()` and use config-provided thresholds when available, falling back to hardcoded defaults.
- Lines 38-44: `MAX_FOCUS` is hardcoded. Same treatment: use config-provided max stocks when available.
- **Implementation note:** `config.scoring` may be `undefined` for existing configs that predate the scoring config block. All config reads must use null-safe access with fallback: `config.scoring?.scoreThresholds?.bull ?? BASE_THRESHOLDS.BULL` and `config.scoring?.maxFocusStocks?.bull ?? MAX_FOCUS.BULL`. Never assume `config.scoring` exists.

**File:** `packages/core/src/mbi/regime-classifier.ts` (lines 26-32)

- Lines 26-32: **Delete** `FOCUS_PARAMS` constant and `getFocusParams()` function entirely. These duplicate `focus-list.ts` with conflicting `maxStocks` values. The canonical values are in `focus-list.ts`:
  - `STRONG_BULL: { threshold: 7.5, maxStocks: 5 }`
  - `BULL: { threshold: 8.0, maxStocks: 5 }`
  - `CAUTIOUS: { threshold: 8.5, maxStocks: 3 }`
  - `CHOPPY: { threshold: 9.0, maxStocks: 2 }`
  - `BEAR: { threshold: 10.0, maxStocks: 0 }`
- `regime-classifier.ts` had `STRONG_BULL: maxStocks: 12`, `BULL: maxStocks: 10`, etc. -- these are wrong. The `focus-list.ts` values (5/5/3/2/0) are canonical and must be the single source of truth.
- Any callers of `getFocusParams()` must be updated to import from `focus-list.ts` or call `generateFocusList()` directly.

**Acceptance:** Changing `scoring.scoreThresholds.bull` in `~/.stark/config.json` from 8.0 to 7.5 actually changes the focus-list threshold for BULL regime. No hardcoded values override config. `getFocusParams` no longer exists in regime-classifier.ts. `grep -r getFocusParams` returns zero results outside of focus-list.ts.

### TODO 5.4: Add consumer alignment tests

**File:** `packages/core/tests/focus-list.test.ts`

- Add test: focus list with custom config thresholds uses config values, not hardcoded defaults.
- Add test: BEAR regime returns empty list regardless of scores.
- Add test: all consumer paths produce identical results for same inputs.

**Acceptance:** All focus-list tests pass. Config-driven thresholds work end-to-end.

---

## Success Criteria

1. All 321 existing tests pass (with updated expectations where audit findings changed behavior)
2. New tests cover all 9 audit findings with positive and negative cases
3. `stark score SYMBOL` resolves tokens from watchlist/instrument master (not hardcoded '0')
4. `stark evening` produces PARTIAL scores; `stark review` finalizes to COMPLETE
5. `stark entry` rejects trades exceeding risk limits (unless `--force`) -- both CLI and Telegram entry paths enforce risk controls (riskProfile is required on EntryInput)
6. `stark morning` and cron morning use `generateFocusList()` with regime-aware thresholds
7. Auth failure without `STARK_MOCK=1` throws a clear error (no silent mock fallback)
8. Portfolio sync never fabricates exit prices for missing positions
9. Telegram review tool clearly states overrides are not persisted
10. Config `scoring.scoreThresholds` and `scoring.maxFocusStocks` are wired into runtime behavior (null-safe: `config.scoring?.scoreThresholds?.bull ?? BASE_THRESHOLDS.BULL`)
11. `semiDiscretionaryIds` includes `pattern_quality` (6 semi-discretionary factors, 7 algorithmic)
12. `stark focus --include-unreviewed` shows PARTIAL stocks; default shows COMPLETE-only
13. `getFocusParams()` deleted from regime-classifier.ts; `focus-list.ts` values (5/5/3/2/0) are the single source of truth

---

## ADR: Architectural Decision Record

**Decision:** Fix all 9 audit findings in 5 sequential phases with strict dependency ordering.

**Drivers:**
1. Data source integrity (CRITICAL auth finding)
2. Score lifecycle correctness (HIGH scoring/review findings)
3. Trade record durability (HIGH sync/risk findings)

**Alternatives considered:**
- Parallel tracks (2 worktrees) -- rejected due to dependency conflicts in shared files and risk of merge errors in a live trading system
- Partial fix (auth only, defer rest) -- rejected because scoring and review findings are HIGH severity and the system is actively used for trading decisions

**Why chosen:** Sequential phases match the natural dependency graph (auth -> scoring -> review -> sync -> consumers). Each phase is independently shippable. No merge coordination overhead. Lowest risk for a live trading system.

**Consequences:**
- Slower wall-clock delivery (~5 phases vs ~2 parallel tracks)
- Each phase must be fully tested before proceeding
- MockProvider behavior changes may temporarily affect development workflow (mitigated by STARK_MOCK env var)

**Follow-ups:**
- After all phases: comprehensive E2E test of evening -> review -> morning -> entry workflow
- Consider adding a `stark doctor` command that validates config completeness and auth health
- Consider adding database migration versioning (currently raw SQL array)
- Evaluate whether `score_breakdown_json` should be removed entirely in favor of always reading from individual factor columns
- Update CLAUDE.md project description from "8 algorithmic + 5 semi-discretionary" to "7 algorithmic + 6 semi-discretionary" after Phase 2 ships
