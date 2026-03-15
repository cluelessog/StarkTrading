# PRD: Code Audit Fixes

**Source:** Consensus-approved plan at `.omc/plans/plan-audit-fixes.md`
**Audit:** `docs/code-audit-findings-2026-03-15.md`
**Date:** 2026-03-15
**Status:** Ready for execution

---

## Problem Statement

A deep code audit found 9 issues (1 CRITICAL, 5 HIGH, 3 MEDIUM) in the Stark trading system. The most dangerous: broker authentication always silently fails and falls back to synthetic mock data, meaning all automated workflows (scoring, sync, cron) run on fake data without the operator knowing. Additionally, the scoring workflow never produces PARTIAL status, risk controls are advisory-only, portfolio sync fabricates zero-PnL exits, and multiple consumers bypass regime-aware focus-list logic.

## Goals

1. Eliminate silent data source degradation — fail closed on auth failure
2. Implement the PARTIAL→COMPLETE scoring lifecycle per the PRD
3. Make risk controls enforce before trade insertion, not warn after
4. Stop fabricating trade exits for missing broker positions
5. Route all focus-list consumers through shared regime-aware logic

## Non-Goals

- Rewriting the scoring engine architecture
- Adding new scoring factors
- Building a web UI for review
- Changing the database schema beyond what's needed for the fixes
- Performance optimization

## Technical Constraints

- Bun + TypeScript monorepo; tests on NTFS (`/mnt/c/`), source on exFAT (`/mnt/d/`)
- `rsync -a --delete packages/ /mnt/c/.../packages/` before running tests
- All work in git worktrees, never directly on master
- `bun:test` (not vitest), `bun:sqlite`
- No npm API SDKs — direct HTTP fetch only
- 346 existing tests must not regress (some will need updated expectations)

---

## User Stories

### US-001: Auth fails closed (Phase 1)
**Priority:** 1 (CRITICAL)
**Description:** As a trader, I want broker auth failure to crash loudly so I never unknowingly trade on fake data.
**Acceptance Criteria:**
- [ ] `AngelOneConfig` has `password?: string` field (`config/index.ts`)
- [ ] `SessionManager.ensureAuthenticated()` passes `{ clientcode, password, totp }` (not `{ clientId, totp }`)
- [ ] Auth failure throws error, never silently falls back to MockProvider
- [ ] `STARK_MOCK=1` env var explicitly enables MockProvider with loud `[MOCK MODE]` banner
- [ ] MockProvider still works for test suites (no test breakage)
- [ ] Updated session-manager tests: no test expects silent mock fallback
- [ ] New test: missing password → throws (not fallback)
- [ ] New test: `STARK_MOCK=1` → MockProvider with warning
- [ ] New test: valid credentials → passes `clientcode`, `password`, `totp`
- [ ] Typecheck passes
- [ ] All tests pass

### US-002: Scoring produces PARTIAL status (Phase 2)
**Priority:** 2 (HIGH)
**Description:** As a trader, I want batch scoring to produce PARTIAL status so I know which stocks still need my review before they enter the focus list.
**Acceptance Criteria:**
- [ ] `semiDiscretionaryIds` includes `pattern_quality` (6 total: linearity, not_pivot_cutter, aoi, hve_hvy, hvq_2_5, pattern_quality)
- [ ] Factor split is 7 algorithmic + 6 semi-discretionary
- [ ] `scoreBatch()` produces `status='PARTIAL'` for all stocks
- [ ] `scoreSymbol()` with `reviewedFactorIds` covering all 6 semi-discretionary IDs → `status='COMPLETE'`
- [ ] `generateFocusList()` accepts `includePartial?: boolean` (default `false`)
- [ ] `stark focus` returns only COMPLETE stocks
- [ ] `stark focus --include-unreviewed` includes PARTIAL stocks
- [ ] Updated scoring-engine tests assert PARTIAL (not COMPLETE) after batch
- [ ] Updated llm-integration tests for PARTIAL status
- [ ] New test: `pattern_quality` in `semiDiscretionaryIds`
- [ ] Typecheck passes
- [ ] All tests pass

### US-003: Review persistence is coherent (Phase 3)
**Priority:** 3 (HIGH)
**Description:** As a trader, I want reviewing a stock to always produce a consistent, finalized score — even when I make no changes.
**Acceptance Criteria:**
- [ ] Review queue filters on `WHERE status = 'PARTIAL'` (not `total_score >= 3`)
- [ ] Review UPDATE runs even when `overrideCount === 0`
- [ ] UPDATE persists all 13 factor columns (7 algo + 6 semi-disc)
- [ ] `score_breakdown_json` is rebuilt from factor columns
- [ ] `status = 'COMPLETE'`, `reviewed_at`, `override_count` are set atomically
- [ ] New test: review with no overrides → status='COMPLETE', reviewed_at set
- [ ] New test: review with overrides → consistent score_breakdown_json
- [ ] Typecheck passes
- [ ] All tests pass

### US-004: Token resolution for single-symbol scoring (Phase 3)
**Priority:** 3 (HIGH)
**Description:** As a trader, I want `stark score RELIANCE` to resolve the real broker token instead of sending '0'.
**Acceptance Criteria:**
- [ ] `score.ts` resolves token from watchlist or instrument master (not hardcoded '0')
- [ ] Telegram score tool resolves tokens identically
- [ ] Unknown symbol → clear error message (not silent failure)
- [ ] New test: single-symbol scoring with resolved token
- [ ] Typecheck passes
- [ ] All tests pass

### US-005: Portfolio sync stops fabricating exits (Phase 4)
**Priority:** 4 (HIGH)
**Description:** As a trader, I want missing broker positions to stay OPEN with a warning, not get auto-closed at zero P&L.
**Acceptance Criteria:**
- [ ] Missing broker position → trade stays OPEN, warning in `result.warnings`
- [ ] No `tradeManager.exit()` call for missing positions
- [ ] `result.autoExits` is empty for missing positions
- [ ] Automation log entry with `action='sync_unresolved'`
- [ ] Updated portfolio-sync tests expect warnings (not auto-exits)
- [ ] Empty `catch {}` on exit path replaced with warning push
- [ ] Typecheck passes
- [ ] All tests pass

### US-006: Risk controls enforce before insertion (Phase 4)
**Priority:** 4 (HIGH)
**Description:** As a trader, I want the system to reject trades that exceed my risk limits before inserting them.
**Acceptance Criteria:**
- [ ] `riskProfile` is REQUIRED on `EntryInput` (not optional)
- [ ] `entry()` throws when `riskAmount > riskProfile.riskPerTrade`
- [ ] `entry()` throws when portfolio heat exceeds `heatAlert`
- [ ] `force: true` allows override with logged warning
- [ ] CLI `entry.ts` passes `riskProfile: config.risk.swing`
- [ ] Telegram entry tool passes `riskProfile: ctx.config.risk.swing`
- [ ] `portfolio-sync.ts` entry calls updated for required `riskProfile`
- [ ] Heat check happens BEFORE insertion (not after)
- [ ] New test: excessive risk → throws
- [ ] New test: `force: true` → succeeds with warning
- [ ] New test: heat exceeds alert → throws
- [ ] Typecheck passes
- [ ] All tests pass

### US-007: Focus-list consumers use shared logic (Phase 5)
**Priority:** 5 (MEDIUM)
**Description:** As a trader, I want all surfaces (CLI, Telegram, cron) to show the same regime-aware focus list.
**Acceptance Criteria:**
- [ ] `morning.ts` calls `generateFocusList()` (no raw SQL)
- [ ] `cron-start.ts` calls `generateFocusList()` (no raw SQL)
- [ ] Telegram focus tool calls `generateFocusList()` (no raw SQL)
- [ ] Telegram morning tool calls `generateFocusList()` (no raw SQL)
- [ ] In BEAR regime, focus list returns 0 stocks
- [ ] `getFocusParams()` deleted from `regime-classifier.ts`
- [ ] `grep -r getFocusParams` returns zero results outside focus-list.ts
- [ ] Canonical values: focus-list.ts (5/5/3/2/0)
- [ ] Typecheck passes
- [ ] All tests pass

### US-008: Config knobs wired + Telegram review stub marked (Phase 5)
**Priority:** 5 (MEDIUM)
**Description:** As a trader, I want config changes to actually affect runtime behavior, and I want Telegram to be honest about what it can't do.
**Acceptance Criteria:**
- [ ] `generateFocusList()` accepts optional config thresholds
- [ ] Null-safe: `config.scoring?.scoreThresholds?.bull ?? BASE_THRESHOLDS.BULL`
- [ ] Changing config threshold actually changes focus-list behavior
- [ ] Telegram review tool says `[NOT PERSISTED]` (no false acknowledgement)
- [ ] New test: custom config thresholds override defaults
- [ ] Typecheck passes
- [ ] All tests pass

---

## Implementation Phases

| Phase | User Stories | Worktree Branch | Files | Lines |
|-------|-------------|-----------------|-------|-------|
| 1 | US-001 | `audit-phase1-auth` | 4 | ~80 |
| 2 | US-002 | `audit-phase2-scoring` | 5 | ~90 |
| 3 | US-003, US-004 | `audit-phase3-review-token` | 4 | ~120 |
| 4 | US-005, US-006 | `audit-phase4-sync-risk` | 5 | ~120 |
| 5 | US-007, US-008 | `audit-phase5-consumers` | 6 | ~80 |

## Verification

After all phases:
- All 346+ tests pass (with updated expectations + new tests)
- `bunx tsc --noEmit` passes (pre-existing errors excluded)
- Full evening→review→morning→entry workflow works end-to-end
- No raw focus-list SQL outside `focus-list.ts`
- No silent MockProvider fallback
- No fabricated trade exits
- Risk enforcement on all entry paths
