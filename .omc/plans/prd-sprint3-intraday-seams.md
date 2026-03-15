# PRD: Sprint 3 — Intraday Seams Verification

**Created:** 2026-03-12
**Execution plan:** `plan-logging-intraday-worktrees.md` Part 2
**Worktree:** `feat/intraday-seams`
**Baseline:** 172 tests pass, 3 pre-existing failures

---

## Problem Statement

The intraday extensibility plan defined 7 architectural seams to enable future intraday trading without rewrite. Most seams were implemented during earlier phases, but no formal verification exists. Two small items remain: a config field addition and TODO comments for Phase 3.

## Goals

- Verify all 7 seams are present in the codebase
- Add `mbiRefreshInterval` to runtime `StarkConfig` (Seam 3 gap)
- Add TODO comments for trade_type analytics filter (Seam 6)
- Create verification test suite proving all seams exist

## Non-Goals

- Building any intraday features
- Changing runtime behavior
- Adding intraday-specific code (only seams/types/config)

## Technical Constraints

- New test file uses `import { ... } from 'bun:test'`
- Changes are minimal — mostly verification, not implementation
- Must not break any existing tests

## Acceptance Criteria

### Seam Verification (all 7)
- [ ] Seam 1: `trade_type` column exists in `trade_journal` and `positions` tables with `CHECK (trade_type IN ('swing', 'intraday'))`
- [ ] Seam 2: `OHLCVInterval` type includes `'1m' | '5m' | '15m' | '75m'` (ALREADY DONE)
- [ ] Seam 3: `StarkConfig` has `mbiRefreshInterval` field (add to runtime config if missing from `config/index.ts`)
- [ ] Seam 4: `RiskConfig` has `swing` and `intraday` profiles
- [ ] Seam 5: `sector_money_flow.captured_at` uses `datetime('now')` default
- [ ] Seam 6: TODO comment added in queries for future `trade_type` filter
- [ ] Seam 7: `mbi_daily` table has composite `PRIMARY KEY (date, captured_at)`

### Tests
- [ ] 7 verification tests (one per seam) pass
- [ ] Tests verify schema strings, type shapes, and config fields
- [ ] All existing 172 tests still pass

### Global
- [ ] `bun run typecheck` passes
- [ ] 1-2 commits total

## Verification Commands

```bash
cd /mnt/c/SteveTrading-intraday && bun test                    # ~179 pass, 3 pre-existing fail
cd /mnt/d/Projects/SteveTrading-intraday && bun run typecheck   # zero errors
```
