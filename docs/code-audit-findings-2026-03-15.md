# Code Audit Findings - 2026-03-15

## Purpose

This file is a handoff for Claude Code to fix the highest-risk issues found in a deep code review of the SteveTrading codebase, with emphasis on trading-system correctness rather than style.

## Overall Recommendation

Status: REQUEST CHANGES

The repo has strong test coverage, but several risky behaviors are currently encoded as expected behavior by the test suite. In particular, the live-vs-mock data path, scoring workflow, review persistence, and trade-sync semantics need correction before trusting the system for production trading workflows.

## Verification Snapshot

- `bun test` passed: 321 tests, 0 failures
- This increases confidence that the findings below are real product/design gaps, not transient regressions

## Fix Order

1. Fix broker authentication and remove silent production fallback to mock data
2. Implement the intended two-phase `PARTIAL -> COMPLETE` scoring workflow
3. Repair review persistence so manual review produces a durable, internally consistent final score
4. Fix single-symbol scoring token resolution
5. Fix portfolio sync exit handling to avoid fabricated flat exits
6. Enforce real risk controls on entry
7. Align focus-list consumers and Telegram tools with core workflow behavior

## Findings

### 1. CRITICAL - Auto-authenticated workflows can silently run on fake market data

Files:
- `packages/core/src/auth/session-manager.ts`
- `packages/core/src/api/angel-one.ts`
- `packages/cli/src/utils/command-context.ts`
- `packages/core/src/api/mock-provider.ts`

Problem:
- `SessionManager.ensureAuthenticated()` passes `{ clientId, totp }` into `AngelOneProvider.authenticate()`
- `AngelOneProvider.authenticate()` actually requires `{ clientcode, password, totp }`
- On failure, the code falls back to `MockProvider`
- `createCommandContext()` uses that path for CLI and long-running workflows

Why this is dangerous:
- Evening scoring, morning prep, breadth fallback, and sync can all appear to work while using synthetic random fixtures instead of live broker data
- This is unacceptable for a trading system because it creates false confidence, not a clean failure

Required fix:
- Plumb password into `SessionManager`
- Pass `clientcode`, not `clientId`
- Fail closed for production workflows instead of silently switching to `MockProvider`
- If mock mode is kept, gate it behind an explicit operator-visible config flag and loud warnings

### 2. HIGH - Intended two-phase scoring workflow is not implemented

Files:
- `docs/PRD_Dexter_Trading_v4.1_CORRECTED.md`
- `docs/SYSTEM_DESIGN_v4.1_CORRECTIONS.md`
- `packages/core/src/scoring/registry.ts`
- `packages/core/src/scoring/engine.ts`
- `packages/core/tests/scoring-engine.test.ts`
- `packages/core/tests/llm-integration.test.ts`

Problem:
- The product docs describe a hybrid workflow where algorithmic factors produce a `PARTIAL` score and discretionary factors are completed later by user review
- The implementation currently registers all five discretionary factors as enabled scoring inputs and runs them during the automated scoring pass
- `ScoringEngine` marks a stock `COMPLETE` once all enabled factors are scored
- Tests currently assert that this is correct

Why this is dangerous:
- LLM-assisted or heuristic judgments are being treated as if the trader personally reviewed them
- Focus-list generation and downstream trade decisions can promote names that should still be pending human confirmation

Required fix:
- Separate true auto-scored factors from review-only factors
- Persist discretionary fields as `null` during the batch scoring pass
- Persist `status = 'PARTIAL'` until manual review completes the score
- Update tests to reflect the intended workflow rather than the current drift

### 3. HIGH - Review flow does not persist a coherent final score

Files:
- `packages/cli/src/commands/review.ts`
- `packages/core/src/db/queries.ts`

Problem:
- The review queue ignores stored `status`
- It infers display status from `discretionary_score > 0`
- It only writes updates when overrides were made
- It only persists the five discretionary columns even though the UI allows overrides for all factors
- It does not rebuild `score_breakdown_json`
- Reads later prefer stale `score_breakdown_json` when present

Why this is dangerous:
- A trader can review a stock, make no changes, and still never finalize it
- A trader can override algorithmic factors in the UI, but the durable row data can remain inconsistent with the displayed totals
- Journaling and analytics can consume stale score breakdowns

Required fix:
- Drive the review queue from stored `status`
- Always finalize a reviewed row, even when no values changed
- Persist updated factor columns for every overrideable factor
- Rebuild and store `score_breakdown_json`
- Persist `status`, `reviewed_at`, `override_count`, and totals atomically

### 4. HIGH - Position-risk controls are advisory only, not enforced

Files:
- `packages/cli/src/commands/entry.ts`
- `packages/core/src/journal/trade-manager.ts`
- `packages/core/src/config/index.ts`
- `packages/core/src/journal/portfolio-heat.ts`

Problem:
- Entry takes user-provided share count as-is
- Risk is calculated after the trade details are accepted
- Portfolio heat is only shown after the trade has already been inserted
- `riskPerTrade` exists in config but is not enforced in the entry workflow

Why this is dangerous:
- The system can record oversize trades and only warn after the fact
- In trading software, risk rules must block or resize, not merely log

Required fix:
- Enforce `riskPerTrade` before inserting the trade
- Compute recommended/maximum shares from entry and stop
- Reject or require explicit override when heat or risk limits are breached
- Keep CLI behavior aligned with any future Telegram entry path

### 5. HIGH - Portfolio sync fabricates flat exits

Files:
- `packages/core/src/journal/portfolio-sync.ts`
- `packages/core/src/journal/trade-manager.ts`

Problem:
- When an open Stark trade no longer exists in broker positions, sync tries to auto-close it
- The code then attempts to read a matching broker position from the same list it already proved does not contain that symbol
- It falls back to `trade.entryPrice` as the exit price

Why this is dangerous:
- Missing broker positions can be auto-closed at zero P&L
- This corrupts performance reporting, factor-edge analysis, and trade history

Required fix:
- Do not invent an exit price
- Pull actual exit/fill/order history if available
- If exact exit data is unavailable, mark the trade unresolved or require manual reconciliation

### 6. HIGH - Single-symbol scoring is broken on the live broker path

Files:
- `packages/cli/src/commands/score.ts`
- `packages/telegram/src/executor.ts`
- `packages/core/src/api/angel-one.ts`

Problem:
- CLI single-symbol scoring and Telegram single-symbol scoring pass token `'0'`
- Angel One historical fetch uses the token directly as `symboltoken`

Why this is dangerous:
- Manual symbol scoring can fail or score empty data in production
- This specifically affects discretionary workflows where an operator wants to inspect one stock on demand

Required fix:
- Resolve token from watchlist or instrument master before scoring
- Fail clearly if token resolution is unavailable
- Add tests for single-symbol scoring in live-like conditions

### 7. MEDIUM - Focus-list consumers bypass regime-aware threshold logic

Files:
- `packages/core/src/mbi/focus-list.ts`
- `packages/cli/src/commands/morning.ts`
- `packages/cli/src/commands/cron-start.ts`
- `packages/telegram/src/executor.ts`

Problem:
- Core focus-list generation correctly applies regime-aware thresholding and limits
- Several consumers instead query the top `COMPLETE` scores directly with `ORDER BY total_score DESC LIMIT N`

Why this matters:
- In weaker market regimes, these surfaces can show names that should not qualify under the actual focus-list rules

Required fix:
- Route all focus-list consumers through the same shared generator
- Avoid duplicating SQL that sidesteps threshold and regime logic

### 8. MEDIUM - Telegram mutation tools acknowledge actions without persisting them

Files:
- `packages/telegram/src/executor.ts`

Problem:
- Telegram `review`, `entry`, and `exit` tools return success-style summaries
- They do not update scores, call `TradeManager`, or persist any change

Why this matters:
- The bot can tell the operator that an action was logged when nothing changed in the database
- In a trading workflow, false acknowledgements are operationally dangerous

Required fix:
- Either wire Telegram commands into the same mutation paths as CLI
- Or explicitly mark those commands unsupported until true persistence is implemented

### 9. MEDIUM - Runtime policy knobs are only partially wired

Files:
- `packages/core/src/config/index.ts`
- `packages/core/src/mbi/focus-list.ts`
- `packages/core/src/mbi/regime-classifier.ts`

Problem:
- Config exposes `riskPerTrade`, `scoreThresholds`, and `maxFocusStocks`
- Runtime focus generation still relies on hardcoded threshold/limit tables
- `riskPerTrade` is not enforced by the entry path

Why this matters:
- Operators can reasonably assume config changes affect trading behavior when they currently do not

Required fix:
- Either fully wire these config values into runtime behavior
- Or remove/deprecate inactive knobs until implemented

## Notes For Claude Code

- Treat the PRD and system-design docs as the intended source of truth for scoring unless the user explicitly confirms a product-direction change
- The current tests are not enough; several of them encode the wrong behavior and will need to be rewritten alongside the fixes
- Prioritize correctness and fail-safe behavior over convenience, especially around auth, data source selection, review state, and trade reconciliation
