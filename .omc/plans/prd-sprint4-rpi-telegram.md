# PRD: Sprint 4 -- RPi + Telegram

**Date:** 2026-03-14
**Source:** `exec-sprint4-rpi-telegram.md` (consensus-approved execution plan)
**Baseline:** 257 tests pass on master, 0 failures
**Execution:** `/ralph` with worktree isolation

---

## Problem Statement

Stark-Trading is a CLI-only tool that requires manual execution of evening/morning workflows and trade journaling. There is no way to interact with Stark from a phone, no automated scheduling, and no portfolio sync with the broker. This sprint adds always-on automation (scheduler + Telegram bot) and closes the auto-journaling gap (portfolio sync).

## Goals

1. Telegram bot that accepts natural language commands and returns formatted results
2. Trading-day-aware scheduler that runs evening/morning workflows unattended
3. Portfolio sync that auto-journals broker positions into Stark's trade journal
4. Proactive notifications pushed to Telegram after scheduled workflows
5. RPi deployment docs for always-on operation

## Non-Goals

- No web UI or Tauri app (future sprint)
- No intraday trading features (seams exist but not implemented)
- No credential encryption (backlog item)
- No Chartink scraper (backlog item)
- No WhatsApp/Discord platforms (seams exist for future)

## Technical Constraints

- **Worktrees required** -- never work directly on master
- **Tests on NTFS** -- copy from `/mnt/d/` to `/mnt/c/` before running `bun test`
- **bun:test** -- NOT vitest
- **No npm SDKs** -- all APIs use direct `fetch()`
- **Graceful degradation** -- everything works without LLM, without broker auth (MockProvider fallback)
- **exFAT limitations** -- no symlinks on `/mnt/d/`, `bun install --backend copyfile` for workspace packages

---

## Implementation Phases

### Phase 1: Foundation (Worktree: `sprint4-foundation`)

**Scope:** DB migration v2, config extension, busy_timeout, `LLMService.complete()`, `EntryInput.stopPrice` optional, `PersistentCommandContext`

**Files to modify (7):**
- `packages/core/src/db/schema.ts` -- migration v2 (automation_log + chat_sessions tables)
- `packages/core/src/db/adapter.ts` -- `PRAGMA busy_timeout = 5000`
- `packages/core/src/db/queries.ts` -- 5 new query methods (chat + automation log)
- `packages/core/src/config/index.ts` -- `TelegramConfig`, `SchedulerConfig` interfaces
- `packages/core/src/llm/llm-service.ts` -- `complete()` + `canComplete()` methods
- `packages/core/src/journal/trade-manager.ts` -- `EntryInput.stopPrice: number | undefined`, conditional risk math
- `packages/cli/src/utils/command-context.ts` -- `PersistentCommandContext` with `dispose()`, `refreshAuth()`, `isHealthy()`

**Tests to add/extend:**
- `packages/core/tests/db.test.ts` -- migration v2, chat/automation query round-trips, busy_timeout
- `packages/core/tests/llm-service.test.ts` -- `canComplete()`, `complete()` with mock fetch

### Phase 2: Portfolio Sync (Worktree: `sprint4-sync`, after Phase 1 merges)

**Scope:** `fetchPositions()` on DataProvider, `PortfolioSync` class, `stark sync` CLI command

**New files (3):**
- `packages/core/src/journal/portfolio-sync.ts` -- PortfolioSync class (~120 lines)
- `packages/core/tests/portfolio-sync.test.ts` -- sync tests (~80 lines)
- `packages/cli/src/commands/sync.ts` -- CLI command (~40 lines)

**Files to modify (4):**
- `packages/core/src/api/data-provider.ts` -- `BrokerPosition` interface + `fetchPositions()`
- `packages/core/src/api/angel-one.ts` -- implement `fetchPositions()`
- `packages/core/src/api/mock-provider.ts` -- stub `fetchPositions()` with fixtures
- `packages/cli/bin/stark.ts` -- register `sync` command

### Phase 3: Telegram Bot (Worktree: `sprint4-telegram`, after Phase 1 merges, parallel with Phase 2)

**Scope:** New `packages/telegram/` workspace -- bot, NLU, executor, formatter, sessions

**New files (13):**
- `packages/telegram/package.json`
- `packages/telegram/tsconfig.json`
- `packages/telegram/src/platform.ts` -- MessagePlatform interface
- `packages/telegram/src/telegram-platform.ts` -- Telegram Bot API long-polling
- `packages/telegram/src/platform-factory.ts` -- platform factory
- `packages/telegram/src/tool-registry.ts` -- StarkTool + ToolRegistry
- `packages/telegram/src/executor.ts` -- register all 16+ tools (~350 lines)
- `packages/telegram/src/nlu.ts` -- regex exact match + Gemini fallback (~180 lines)
- `packages/telegram/src/formatter.ts` -- TelegramFormatter for MarkdownV2 (~160 lines)
- `packages/telegram/src/session.ts` -- ChatSessionManager
- `packages/telegram/src/index.ts` -- entry point wiring
- `packages/telegram/bin/stark-telegram.ts` -- systemd entry script
- `packages/telegram/tests/nlu.test.ts` -- NLU exact-match tests

**Root config:** Add `@stark/telegram` path alias to `tsconfig.json`

### Phase 4: Scheduler + Notifications (Same worktree as Phase 3: `sprint4-telegram`)

**Scope:** TradingScheduler, `stark cron`, NotificationChannel, TelegramNotifier

**New files (7):**
- `packages/core/src/scheduler/scheduler.ts` -- TradingScheduler (~100 lines)
- `packages/core/src/scheduler/index.ts` -- barrel export
- `packages/core/tests/scheduler.test.ts` -- scheduler tests (~60 lines)
- `packages/cli/src/commands/cron-start.ts` -- `stark cron` command (~60 lines)
- `packages/core/src/notifications/channel.ts` -- NotificationChannel interface
- `packages/core/src/notifications/telegram-notifier.ts` -- TelegramNotifier (~50 lines)
- `packages/core/src/notifications/index.ts` -- barrel export

**Files to modify (1):**
- `packages/cli/bin/stark.ts` -- wire `cron` case (already in COMMANDS, falls through to default)

### Phase 5: Deployment + Final Tests (Direct on master after all merges)

**New files (4):**
- `packages/telegram/tests/executor.test.ts` -- executor tests (~80 lines)
- `docs/RPI_DEPLOYMENT.md` -- RPi setup guide (~200 lines)
- `docs/TELEGRAM_SETUP.md` -- BotFather + config guide (~80 lines)
- `scripts/ups-monitor.sh` -- UPS battery monitor (~25 lines)

---

## Acceptance Criteria (Definition of Done)

### Phase 1 Gate (must pass before Phases 2/3 start)
- [ ] `SCHEMA_VERSION === 2`; fresh DB has 14 tables (12 v1 + 2 v2)
- [ ] Existing v1 databases migrate cleanly
- [ ] `PRAGMA busy_timeout` returns `5000`
- [ ] `StarkConfig` accepts optional `telegram` and `scheduler` fields; existing configs load correctly
- [ ] `insertChatMessage` + `getRecentChatMessages` round-trip works; messages returned ASC
- [ ] `trimChatHistory(chatId, 10)` keeps exactly the last 10
- [ ] `insertAutomationLog` + `getAutomationLogs` round-trip works; logs returned DESC
- [ ] `LLMService.complete()` returns string; Gemini-first with Claude fallback; no caching
- [ ] `canComplete()` returns true when Gemini or Claude configured, false otherwise
- [ ] `EntryInput.stopPrice` is `number | undefined`; entry with `undefined` stores `null` for riskAmount
- [ ] `entry()` with real stopPrice still computes risk correctly
- [ ] `createPersistentCommandContext()` returns reusable context with `dispose()`, `refreshAuth()`, `isHealthy()`
- [ ] `refreshAuth()` rebuilds full chain: provider, engine, breadthCalc, mbiManager
- [ ] `isHealthy()` returns true for fresh context, false when DB closed
- [ ] All 257 existing tests pass + ~10 new tests pass (~267 total)

### Phase 2 Gate
- [ ] `DataProvider.fetchPositions()` exists on interface
- [ ] `MockProvider.fetchPositions()` returns fixture data
- [ ] `AngelOneProvider.fetchPositions()` implemented (TODO for endpoint if unverified)
- [ ] New broker positions auto-logged via `TradeManager.entry()` with `stopPrice: undefined`
- [ ] Exited positions auto-closed via `TradeManager.exit()` with reason `DISCRETION`
- [ ] Partial quantity changes produce warnings, NOT auto-processed
- [ ] Repeated sync does not create duplicate entries (idempotent)
- [ ] All sync actions logged to `automation_log`
- [ ] `stark sync` registered and prints summary with stop price reminder
- [ ] All existing tests pass + ~8 new tests (~275 total)

### Phase 3 Gate
- [ ] `packages/telegram/` is a valid Bun workspace (auto-discovered by `packages/*`)
- [ ] `allowedChatIds` whitelist rejects unauthorized chats
- [ ] NLU exact matching: "score RELIANCE", "focus list", "open trades", "my heat", "help"
- [ ] NLU case insensitive: "Score reliance" works
- [ ] NLU multi-turn: "score INFY" then "override its linearity" targets INFY
- [ ] NLU Gemini fallback uses `LLMService.complete()` (not raw GeminiClient)
- [ ] Messages >4096 chars split into multiple Telegram messages
- [ ] Network errors trigger exponential backoff reconnect
- [ ] Bot uses `createPersistentCommandContext()` (not `createCommandContext()`)
- [ ] Bot message handler calls `refreshAuth()` before processing
- [ ] 6 extensibility seams present (MessagePlatform, platform column, ToolRegistry+toMCPTools, NLU, ToolResult, formatter)
- [ ] NLU test suite passes (pure string-in/intent-out, no external dependencies)
- [ ] All existing tests pass + ~10 new tests (~285 total)

### Phase 4 Gate
- [ ] Evening callback fires at configured time on trading days only
- [ ] Morning callback fires at configured time on trading days only
- [ ] Sync fires every N minutes during market hours (9:15-15:30 IST) on trading days
- [ ] Weekends and NSE holidays skipped (reads `config.nseHolidays`, NOT `SchedulerConfig`)
- [ ] Duplicate runs within same day prevented
- [ ] Year-validity warning logged when `nseHolidays` doesn't cover current year
- [ ] All scheduler callbacks call `refreshAuth()` before running
- [ ] `stark cron` keeps running indefinitely (replaces "not yet implemented" stub)
- [ ] Evening pushes focus list summary to Telegram
- [ ] Morning pushes update only when changes detected
- [ ] Sync notifies only when new entries/exits found
- [ ] Missing Telegram config means notifications silently skipped
- [ ] Scheduler tests pass (~8 new, ~293 total)

### Phase 5 Gate (Sprint 4 Definition of Done)
- [ ] Executor tests pass (score, focus, heat, help, unknown tool)
- [ ] `docs/RPI_DEPLOYMENT.md` covers hardware, systemd, UPS, maintenance
- [ ] `docs/TELEGRAM_SETUP.md` covers BotFather, chat ID, config
- [ ] `scripts/ups-monitor.sh` reads battery via I2C, triggers shutdown at <20%
- [ ] **All tests pass: 257 existing + ~44 new = ~301 total**
- [ ] **Zero regressions**

---

## Merge Order

```
1. sprint4-foundation -> master     (Phase 1)
2. sprint4-sync -> master           (Phase 2, after Phase 1)
3. sprint4-telegram -> master       (Phases 3+4, after Phase 1, parallel with Phase 2)
4. Phase 5 directly on master       (after all merges)
```

Post-merge: run full test suite from `/mnt/c/Projects/SteveTrading` after each merge. Clean up worktrees and branches after successful merge.

---

## Key Design Decisions (from Architect/Critic consensus)

1. **`stopPrice: undefined` not `0`** -- `stopPrice: 0` corrupts risk math (riskPerShare = entryPrice). Make `EntryInput.stopPrice` optional; skip risk calculation when undefined.
2. **No `SchedulerConfig.nseHolidays`** -- `StarkConfig` already has `nseHolidays: string[]`. Scheduler reads it directly. No duplication.
3. **`refreshAuth()` at every entry point** -- Bot message handler and all 3 scheduler callbacks call `refreshAuth()` first. Rebuilds provider → engine → breadthCalc → mbiManager on re-auth.
4. **`isHealthy()` on PersistentCommandContext** -- DB liveness check (`SELECT 1`) + auth session validity. Defensive health check for 24/7 processes.
5. **`complete()` is Gemini-first** -- Unlike `analyzeOHLCV()` (Claude-first), NLU classification is latency-sensitive. Gemini 2.0 Flash is faster/cheaper. Code comment required explaining the inversion.
6. **Executor ~350 lines** -- 16+ tools at ~15-20 lines each. Realistic estimate, not ~250.

---

## Execution Reference

Full implementation details (exact file changes, SQL schemas, code snippets, interface designs) are in:
`/mnt/d/Projects/SteveTrading/.omc/plans/exec-sprint4-rpi-telegram.md`

Ralph should read that file for step-by-step implementation guidance.
