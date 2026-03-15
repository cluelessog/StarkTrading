# Decisions: SteveTrading

> Log of significant plan changes and the reasoning behind them.
> This file survives session restarts — it's the project's institutional memory.

## [2026-03-15] — Auth fail-closed (no silent MockProvider fallback)

**Context**: Code audit found that broker auth failure silently fell back to MockProvider, meaning production workflows could run on fake data without any warning.

**Old Plan**: Auth failure → silently use MockProvider as fallback for development convenience.

**New Plan**: Auth failure → throw error. MockProvider only available when `STARK_MOCK=1` is explicitly set, with loud console warnings.

**Rationale**: Silent degradation is a critical risk for a trading system. Users must know when they're looking at real vs synthetic data.

**Impact**: All code paths that previously caught auth errors and fell back to MockProvider now throw. `import-cmd.ts` and `command-context.ts` updated.

## [2026-03-15] — PARTIAL/COMPLETE scoring lifecycle

**Context**: Code audit found that batch scoring marked results as COMPLETE even though semi-discretionary factors hadn't been human-reviewed.

**Old Plan**: All scored stocks get status COMPLETE immediately after batch scoring.

**New Plan**: Batch scoring always produces PARTIAL status. COMPLETE only after human review of all 6 semi-discretionary factors via `stark review`.

**Rationale**: Prevents focus list from including stocks whose semi-discretionary scores are just algorithmic pre-filters, not validated human judgments.

**Impact**: Focus list defaults to COMPLETE-only stocks. `--include-unreviewed` flag added for seeing PARTIAL stocks. Telegram/CLI consumers updated.

## [2026-03-15] — Single source of truth for focus list

**Context**: Code audit found `getFocusParams()` in regime-classifier.ts had conflicting maxStocks values (12/10/8/5/3) vs the canonical values in focus-list.ts (5/5/3/2/0). Multiple consumers used raw SQL instead of `generateFocusList()`.

**Old Plan**: Two separate constant tables for focus parameters; consumers wrote their own SQL.

**New Plan**: Delete `getFocusParams`/`FOCUS_PARAMS`. All consumers route through `generateFocusList()` in focus-list.ts. Added `scoreThresholds` config option for per-regime threshold overrides.

**Rationale**: Eliminates split-brain risk. One function, one set of values, one place to change.

**Impact**: morning.ts, cron-start.ts, evening.ts, executor.ts (focus + morning tools) all updated. 7 tests removed, 1 added.

## [2026-03-15] — Worktree location policy

**Context**: Worktrees were created as sibling directories outside the project root (e.g., `/mnt/d/Projects/SteveTrading-audit-p5/`), making them hard to track and clean up.

**Old Plan**: `git worktree add` to sibling directories.

**New Plan**: All worktrees under `.claude/worktrees/` within the project directory. `.claude/` added to `.gitignore`. Merges to master require explicit user approval.

**Rationale**: Keeps worktrees discoverable, contained, and gitignored. Prevents accidental merges.

**Impact**: CLAUDE.md and MASTER-PLAN.md rules updated. `.gitignore` updated.
