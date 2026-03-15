# Stark-Trading: Master Plan

**Last updated:** 2026-03-15
**Purpose:** Single source of truth — what's done, what's next, how to execute.

---

## Project

Bun + TypeScript CLI for Indian stock trading. Automates 13-factor scoring (7 algorithmic + 6 semi-discretionary/LLM-enhanced). Three packages: `@stark/core`, `@stark/cli`, `@stark/telegram`.

**On `master` today:** 307 tests pass, 0 fail. 20 CLI commands, 18 Telegram bot tools, 17 DB tables, 34 test files. Core scoring engine, Angel One auth (fail-closed), LLM service (Claude > Gemini), MBI regime classification, PARTIAL/COMPLETE scoring lifecycle, trade journal with risk enforcement, portfolio sync, Telegram bot with NLU, advanced performance analytics.

---

## Completed Sprints

### Sprint 1: MBI Integration -- DONE
Breadth calculator, fallback classifier, Chartink stub, 3-tier MBI fallback, `classifyRegimeFull()`, MBI dashboard, evening/morning regime detection, `stark mbi analyze`.

### Sprint 2: Logging System -- DONE
JSONL logger with runId/component/event fields, `--verbose`/`--quiet` flags, `stark logs` command, state transition logging.

### Sprint 3: Intraday Seams -- DONE
`mbiRefreshInterval` config field, 7 intraday extension seams verified.

### Sprint 4: RPi + Telegram -- DONE
`packages/telegram` workspace. Telegram bot with NLU, TradingScheduler (cron), portfolio sync, trade entry/exit, DB v2 migration (automation_log, chat_sessions), PersistentCommandContext.

### Sprint 5: Telegram Polish -- DONE
Advanced performance analytics (profit factor, max drawdown, Kelly%, streaks), enhanced performance tool, NLU conviction parsing, profitFactor Infinity fix.

### Code Audit Fixes (5 Phases) -- DONE
9 findings (1 CRITICAL, 5 HIGH, 3 MEDIUM) resolved:

| Phase | Fix | Key Change |
|-------|-----|------------|
| 1 | Auth fail closed | `STARK_MOCK=1` gate, no silent MockProvider fallback |
| 2 | PARTIAL/COMPLETE lifecycle | Batch scoring = PARTIAL; COMPLETE only after human review |
| 3 | Review persistence + token resolution | Review persists all 13 factors; token resolved from watchlist/instrument master |
| 4 | Stop fabricated exits + risk controls | Missing broker positions = warning not auto-exit; risk checked before trade insertion |
| 5 | Focus-list consumers + config knobs | All consumers use `generateFocusList()`; `getFocusParams` deleted; `scoreThresholds` config option |

---

## Backlog (Not Yet Planned)

| Item | Notes |
|------|-------|
| Chartink Scraper (unstub) | Feasibility investigation first — currently a stub in `api/chartink.ts` |
| Intraday Trading | Seams ready from Sprint 3, no execution plan yet |
| Credential Encryption | OS keychain for API keys, TOTP secret |
| OpenAlgo Integration | Feasibility plan in `archive/` |
| Web Dashboard | Not scoped — CLI + Telegram covers current needs |
| Config-driven MAX_FOCUS | `scoreThresholds` exists but `maxStocks` per regime not yet configurable |

---

## File Map

```
.omc/plans/
├── MASTER-PLAN.md              <- YOU ARE HERE
├── plan-mbi-worktree.md        <- Sprint 1 execution plan (DONE)
├── plan-logging-intraday-worktrees.md <- Sprints 2+3 execution plan (DONE)
├── plan-pending-parallel.md    <- Merge coordination (DONE)
├── plan-rpi-telegram.md        <- Sprint 4 execution plan (DONE)
├── plan-audit-fixes.md         <- Audit fix plan (DONE)
├── prd-audit-fixes.md          <- Audit fix PRD (DONE)
├── prd-sprint1-mbi.md          <- Sprint 1 PRD (DONE)
├── prd-sprint2-logging.md      <- Sprint 2 PRD (DONE)
├── prd-sprint3-intraday-seams.md <- Sprint 3 PRD (DONE)
├── prd-sprint4-rpi-telegram.md <- Sprint 4 PRD (DONE)
├── open-questions.md           <- Open questions across all plans
└── archive/                    <- Completed/superseded plans
```

---

## Rules

1. **Test-first bug fixes** — Write failing tests, then fix
2. **Always use worktrees** — Create under `.claude/worktrees/` within the project directory. Never outside the project root. Do not merge to master without explicit user approval.
3. **Tests on `/mnt/c/`** — Source on `/mnt/d/` (exFAT), rsync to `/mnt/c/` (NTFS) before running tests (`bun:sqlite` requires NTFS file locking)
4. **One commit per step** — Atomic, rollback-friendly
5. **Consensus before execution** — `/ralplan` for plans, Architect + Critic approval

---

## What To Do Next

All sprints and audit fixes are complete. The system is production-ready for the current scope. Next steps depend on user priorities:

1. **Chartink scraper** — Unstub the Chartink integration for live MBI data (currently using Google Sheet fallback)
2. **Intraday trading** — Build on the seams from Sprint 3; needs a design plan first
3. **Credential encryption** — Harden API key storage with OS keychain
4. **RPi deployment** — Deploy the Telegram bot + scheduler to Raspberry Pi (docs exist in `docs/stark-rpi-telegram.md`)
