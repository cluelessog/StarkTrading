# Implementation Plan: RPi Deployment + Telegram Chat Interface

**Date:** 2026-03-11 (RALPLAN iteration 2)
**Source:** `docs/stark-rpi-telegram.md`
**Status:** Revised -- incorporating Architect + Critic feedback (8 items)
**Estimated complexity:** MEDIUM-HIGH (~2,200 new lines across ~30 files)

---

## RALPLAN-DR Summary

### Principles

1. **Reuse @stark/core entirely** -- The Telegram bot and scheduler are thin wrappers around `CommandContext`, `ScoringEngine`, `TradeManager`, `Queries`, and `LLMService`. Zero duplication of business logic.
2. **No new infrastructure dependencies** -- No Redis, no Docker, no message queues. Just Bun, SQLite, systemd, and `fetch()` for the Telegram Bot API.
3. **Graceful degradation everywhere** -- NLU falls back to exact matching when Gemini is down. Auth failures are reported to user. Network loss triggers systemd restart.
4. **Pi-first, not Pi-only** -- Everything runs on the dev machine too. The Pi is a deployment target, not a platform dependency.
5. **Observable** -- Every automated action logged to `automation_log` table. The user can ask "what happened overnight" and get a complete audit trail.

### Decision Drivers (Top 3)

1. **Always-on requirement** -- Evening/morning workflows must run unattended. RPi 4 at ~5W is cheaper than any cloud hosting.
2. **Chat-first UX** -- Interact with Stark from phone via natural language. Telegram Bot API is free, no webhook server needed (long-polling).
3. **Auto-journaling gap** -- Trades executed on broker are not captured in Stark's journal unless manually logged. Portfolio sync closes this gap.

### Viable Options

#### Option A: systemd + Telegram bot + periodic sync (CHOSEN)

Two systemd services: a scheduler (cron-like) and a Telegram bot (always listening). Both import `@stark/core` directly.

**Pros:** systemd handles restart/boot/logging; independent restartability; simpler than daemon; standard Linux pattern.
**Cons:** Two processes (negligible on 4GB Pi); requires systemd (RPi OS has it; WSL2 does not by default).

#### Option B: Single `stark daemon` with built-in Telegram (REJECTED)

**Why rejected:** Couples scheduling and chat into one process. Telegram long-poll hang blocks scheduler. Scheduler crash kills bot. Separate services are more resilient.

#### Option C: Agent framework (OpenClaw/Nanobot) (REJECTED)

**Why rejected:** Stark is a single-purpose pipeline with 16 CLI commands. An agent framework solves multi-agent coordination and cross-platform routing -- problems that don't exist here. Over-engineering for a command router.

### ADR

- **Decision:** Option A -- systemd services + Telegram bot package + portfolio sync
- **Drivers:** Always-on resilience, separation of concerns, standard Linux deployment
- **Alternatives considered:** Single daemon (coupling risk), agent framework (over-engineering)
- **Consequences:** Requires systemd; user must create Telegram bot via BotFather; RPi setup is one-time manual process
- **Follow-ups:** Phase 4 UI (Tauri/web) can run alongside these services unchanged since all share `@stark/core`

---

## Codebase Gap Analysis

### What Already Exists (no work needed)

| Component | Location | Status |
|-----------|----------|--------|
| `CommandContext` utility | `packages/cli/src/utils/command-context.ts` | Complete -- auto-auth, DB, LLM, engine. **Note:** Creates new DB/auth/LLM per call; not suitable for long-running processes (see Step 1: `createPersistentCommandContext()`). |
| `SessionManager` + TOTP | `packages/core/src/auth/session-manager.ts` | Complete -- `generateTOTP()`, `ensureAuthenticated()`, MockProvider fallback |
| `LLMService` + `GeminiClient` | `packages/core/src/llm/llm-service.ts` | Complete -- Claude primary, Gemini fallback, Perplexity research. **Note:** Only has `analyzeOHLCV()` and `research()`; no generic text completion (see Step 1: `complete()` method). |
| `LLMCache` | `packages/core/src/llm/llm-cache.ts` | Complete |
| `TradeManager` | `packages/core/src/journal/trade-manager.ts` | Complete -- entry/exit/open/closed trades |
| `DataProvider` interface | `packages/core/src/api/data-provider.ts` | Complete -- auth, OHLCV, quotes, symbols |
| `AngelOneProvider` | `packages/core/src/api/angel-one.ts` | Complete |
| `MockProvider` | `packages/core/src/api/mock-provider.ts` | Complete -- fallback for no-broker scenarios |
| `ScoringEngine` + 13 factors | `packages/core/src/scoring/` | Complete |
| `Queries` class | `packages/core/src/db/queries.ts` | Complete -- watchlists, OHLCV, scores, trades, MBI, positions |
| SQLite WAL mode | `packages/core/src/db/adapter.ts` line 29 | Complete |
| Schema v1 (12 tables) | `packages/core/src/db/schema.ts` | Complete |
| Workspace config | `package.json` root `"workspaces": ["packages/*"]` | Complete -- new `packages/telegram` auto-discovered |
| Evening/morning CLI commands | `packages/cli/src/commands/evening.ts`, `morning.ts` | Complete |
| 16 CLI commands | `packages/cli/bin/stark.ts` | Complete (auth, import, score, review, focus, market, evening, morning, status, entry, exit, trades, performance, heat, evolve, setup) |

### What Does NOT Exist (must be built)

| Component | Gap | Plan Step |
|-----------|-----|-----------|
| `createPersistentCommandContext()` | `createCommandContext()` creates new DB/auth/LLM per call; unsuitable for long-running bot/scheduler | Step 1 |
| `LLMService.complete()` method | Only `analyzeOHLCV(prompt, bars)` and `research(query)` exist; no generic text completion for NLU | Step 1 |
| `PRAGMA busy_timeout` | Not set in adapter.ts | Step 1 |
| Schema migration v2 | Only v1 exists; no `automation_log` or `chat_sessions` tables | Step 1 |
| `TelegramConfig` / `SchedulerConfig` in config | Not in `StarkConfig` (note: `NotificationPreferences` deferred -- see Seams section) | Step 1 |
| Chat session query methods | Not in `Queries` class | Step 1 |
| Automation log query methods | Not in `Queries` class | Step 1 |
| `fetchPositions()` on DataProvider | Not in interface or implementations | Step 2 |
| `PortfolioSync` class | No file exists at `packages/core/src/journal/portfolio-sync.ts` | Step 2 |
| `stark sync` CLI command | Not registered in stark.ts | Step 2 |
| `packages/telegram/` workspace | Does not exist | Step 3 |
| Telegram Bot API client | Nothing exists | Step 3 |
| NLU (natural language parsing) | Nothing exists | Step 3 |
| ToolRegistry pattern | Nothing exists | Step 3 |
| `TelegramFormatter` | Nothing exists | Step 3 |
| `packages/core/src/scheduler/` | Directory does not exist | Step 4 |
| `TradingScheduler` class | Nothing exists | Step 4 |
| `NotificationChannel` interface | `packages/core/src/notifications/` does not exist | Step 5 |
| `TelegramNotifier` | Nothing exists | Step 5 |
| RPi deployment docs | Nothing exists | Step 6 |
| UPS monitor script | Nothing exists | Step 6 |

### Relationship to `stark-automation.md` Plan

The existing `stark-automation.md` plan (dated 2026-03-07) proposed a `stark daemon` with file watcher, scheduler, and OS notifications. **This plan partially supersedes it:**

- **Reused concepts:** scheduler, `automation_log` table, TOTP auto-auth (already implemented), `busy_timeout`
- **Dropped:** File watcher (import via Telegram instead), `stark daemon` lifecycle (replaced by systemd), OS `notify-send` (replaced by Telegram notifications)
- **Neither plan has been executed yet** -- the automation plan's Step 1 (busy_timeout, migration v2, scheduler) was never built

---

## Phased Implementation Plan

### Execution Order and Dependencies

```
Step 1: DB + Config + LLMService.complete() + PersistentCommandContext (foundation, no dependencies)
  |
  +---> Step 2: Portfolio Sync (needs Step 1 for automation_log)
  |
  +---> Step 3: Telegram Bot (needs Step 1 for chat_sessions, config, LLMService.complete(), PersistentCommandContext)
           |
           v
         Step 4: Scheduler / `stark cron` (needs Step 1 for automation_log + PersistentCommandContext)
           |
           v
         Step 5: Notifications (needs Step 3 for TelegramNotifier; Step 4 for scheduler callbacks)
                   |
                   v
                 Step 6: RPi Deployment (needs Steps 3-5 working; mostly docs + scripts)
```

Steps 2 and 3 can execute in parallel after Step 1 completes.

---

### Step 1: DB Migration + Config Extension + busy_timeout + Core Interface Extensions

**Objective:** Add foundation tables, config types, query methods, SQLite concurrency fix, persistent command context for long-running processes, and generic LLM completion method for NLU.

**Files to modify (6):**
- `packages/core/src/db/schema.ts` -- add migration v2 (`automation_log` + `chat_sessions` tables; `chat_sessions` includes `platform TEXT DEFAULT 'telegram'` column for Seam 2)
- `packages/core/src/db/adapter.ts` -- add `PRAGMA busy_timeout = 5000` after WAL pragma
- `packages/core/src/db/queries.ts` -- add 5 new query methods (chat messages + automation log)
- `packages/core/src/config/index.ts` -- add `TelegramConfig`, `SchedulerConfig` interfaces and optional fields to `StarkConfig`
- `packages/core/src/llm/llm-service.ts` -- add `complete(prompt: string): Promise<string>` to `LLMService` interface; implement in `LLMServiceImpl` delegating to Gemini (preferred for speed/cost) with Claude fallback
- `packages/cli/src/utils/command-context.ts` -- add `createPersistentCommandContext()` that returns a `PersistentCommandContext` (extends `CommandContext` with `dispose(): void` and `refreshAuth(): Promise<void>`)

**`createPersistentCommandContext()` design:**
- Reuses a single `DatabaseAdapter` and `Queries` instance across calls
- Caches `DataProvider` -- does NOT re-authenticate on every message
- `refreshAuth()` re-runs `sessionManager.ensureAuthenticated()` only when session expires (called by scheduler on each cycle, not per Telegram message)
- `dispose()` closes DB connection -- called on process shutdown (SIGTERM handler)
- The existing `createCommandContext()` remains unchanged for CLI commands

**`LLMService.complete()` design:**
- Signature: `complete(prompt: string): Promise<string>`
- Add `canComplete(): boolean` to interface (true if Gemini or Claude configured)
- Uses Gemini by default (faster, cheaper for text classification). Falls back to Claude if Gemini unavailable.
- No caching (NLU prompts are unique per user message)
- This is the method the NLU (Step 3) calls for intent classification on ambiguous messages

**Estimated new lines:** ~200

**Acceptance Criteria:**
- [ ] `SCHEMA_VERSION` bumped to 2; migration v2 SQL creates `automation_log` and `chat_sessions` tables
- [ ] `chat_sessions` table includes `platform TEXT DEFAULT 'telegram'` column
- [ ] Existing v1 databases migrate cleanly (all tables use `CREATE TABLE IF NOT EXISTS`)
- [ ] `PRAGMA busy_timeout = 5000` set in `BunSQLiteAdapter` constructor
- [ ] `StarkConfig` accepts optional `telegram` and `scheduler` fields without breaking existing configs
- [ ] `insertChatMessage()`, `getRecentChatMessages()`, `trimChatHistory()` work correctly
- [ ] `insertAutomationLog()`, `getAutomationLogs()` work correctly
- [ ] `LLMService.complete(prompt)` returns a string response from Gemini (or Claude fallback)
- [ ] `LLMService.canComplete()` returns true when Gemini or Claude is configured
- [ ] `createPersistentCommandContext()` returns context that reuses DB and provider across multiple accesses
- [ ] `PersistentCommandContext.dispose()` closes the DB connection cleanly
- [ ] `PersistentCommandContext.refreshAuth()` re-authenticates only when session is expired
- [ ] All 184 existing tests still pass

**Risk:** Migration v2 must not break existing databases. Mitigation: use `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS`.

---

### Step 2: `stark sync` Command (Portfolio Auto-Journal)

**Objective:** Diff broker positions against Stark's journal; auto-log new entries/exits via `TradeManager`.

**`PortfolioSync` writes to `trade_journal` table:**
- New entries: calls `TradeManager.entry()` with `conviction: 'MEDIUM'`, `stopPrice: null` (user sets later via `stark exit --override`). Note: `EntryInput.stopPrice` is typed as `number` -- `PortfolioSync` must pass `0` and document that `stopPrice = 0` means "not yet set by user" for auto-synced entries.
- Exits: calls `TradeManager.exit()` with `reason: 'DISCRETION'`
- Does NOT write to the `positions` table (which exists in schema but has no active writers)

**Files to create (3):**
- `packages/core/src/journal/portfolio-sync.ts` -- `PortfolioSync` class (~120 lines)
- `packages/core/tests/portfolio-sync.test.ts` -- tests with MockProvider (~80 lines)
- `packages/cli/src/commands/sync.ts` -- CLI command (~40 lines)

**Files to modify (4):**
- `packages/core/src/api/data-provider.ts` -- add `fetchPositions(): Promise<BrokerPosition[]>` to interface
- `packages/core/src/api/angel-one.ts` -- implement `fetchPositions()` via Angel One portfolio/holdings API
- `packages/core/src/api/mock-provider.ts` -- stub `fetchPositions()` with fixture data
- `packages/cli/bin/stark.ts` -- register `sync` command in COMMANDS and switch

**Estimated new lines:** ~280

**Acceptance Criteria:**
- [ ] `DataProvider` interface has `fetchPositions()` method
- [ ] `AngelOneProvider.fetchPositions()` calls correct Angel One endpoint and maps response
- [ ] `MockProvider.fetchPositions()` returns fixture data for testing
- [ ] New broker positions not in Stark are auto-logged via `TradeManager.entry()` with `conviction: 'MEDIUM'`, `stopPrice: 0`
- [ ] Positions in Stark but not in broker are auto-logged via `TradeManager.exit()` with `reason: 'DISCRETION'`
- [ ] Auto-synced entries are distinguishable (e.g. `tradeType: 'sync'` or a flag) so user knows to set stopPrice
- [ ] Partial exits flagged as warnings, not auto-processed
- [ ] Duplicate syncs on same day don't create duplicate entries
- [ ] All sync actions logged to `automation_log`
- [ ] `stark sync` prints clear summary including count of entries needing stopPrice

**Risk:** Angel One portfolio API endpoint needs verification during implementation. Mitigation: MockProvider allows full test coverage independent of API discovery. Document-specialist agent can fetch Angel One Smart API docs.

---

### Step 3: `packages/telegram` -- Bot + NLU + Executor

**Objective:** Build Telegram bot with natural language interface to all Stark commands.

**Files to create (13):**
```
packages/telegram/
  package.json                    (~10 lines)
  tsconfig.json                   (~10 lines)
  src/
    platform.ts                   -- MessagePlatform interface (Seam 1, ~30 lines)
    telegram-platform.ts          -- Telegram Bot API via fetch() (Seam 1, ~120 lines)
    platform-factory.ts           -- Platform factory (~15 lines)
    nlu.ts                        -- NLU: regex exact match + Gemini fallback via LLMService.complete() (Seam 5, ~180 lines)
    tool-registry.ts              -- StarkTool + ToolRegistry + toMCPTools() (Seam 4, ~60 lines)
    executor.ts                   -- Register all 16+ tools, execute via registry (Seam 4, ~250 lines)
    formatter.ts                  -- TelegramFormatter for MarkdownV2 (Seam 7, ~160 lines)
    session.ts                    -- ChatSessionManager (Seam 2, ~40 lines)
    index.ts                      -- Entry point: wire platform+NLU+executor+sessions (~50 lines)
  tests/
    nlu.test.ts                   -- NLU exact-match parsing tests (pure string-in/intent-out, ~100 lines)
  bin/
    stark-telegram.ts             -- Systemd entry script (~10 lines)
```

**Estimated new lines:** ~1,035

**Key Design Decisions:**
- Long-polling (not webhooks) -- no public IP needed
- `allowedChatIds` whitelist for security
- NLU: regex exact matching handles ~80% of messages; Gemini called via `LLMService.complete()` (Step 1) only for ambiguous natural language
- ToolRegistry pattern enables auto-generated NLU prompts and future MCP server (Seam 4)
- Executor returns structured `{ data, summary }` -- formatter is per-platform (Seam 7)
- Conversation history: last 10 messages per chat in SQLite for multi-turn pronoun resolution

**Acceptance Criteria:**
- [ ] `bun run packages/telegram/bin/stark-telegram.ts` connects and responds to messages
- [ ] `allowedChatIds` whitelist rejects unauthorized chats
- [ ] Exact matching: "score RELIANCE", "focus list", "my heat", "open trades"
- [ ] Gemini NLU: "how did TATAELXSI score?" -> `{ command: 'score', args: { symbol: 'TATAELXSI' } }`
- [ ] Multi-turn: "score INFY" then "override its linearity to 1" correctly targets INFY
- [ ] Messages >4096 chars split into multiple Telegram messages
- [ ] Network errors reconnect with exponential backoff
- [ ] Bot works on dev machine (not Pi-specific)
- [ ] NLU exact-match parsing tests pass (pure string-in/intent-out, no external dependencies)
- [ ] NLU Gemini fallback uses `LLMService.complete()` from Step 1 (not raw `GeminiClient`)
- [ ] Bot entry point uses `createPersistentCommandContext()` from Step 1 (not `createCommandContext()`)
- [ ] 6 extensibility seams verified (MessagePlatform, platform column, NotificationChannel, ToolRegistry, platform-agnostic NLU, structured ToolResult)

**Risk:** Telegram MarkdownV2 escaping is notoriously tricky (11 special characters). Mitigation: build a dedicated `escapeMarkdownV2()` utility and test it thoroughly.

---

### Step 4: Scheduler Service

**Objective:** Run evening/morning workflows and portfolio sync on a trading-day-aware schedule.

**Files to create (3):**
- `packages/core/src/scheduler/scheduler.ts` -- `TradingScheduler` class (~100 lines)
- `packages/core/src/scheduler/index.ts` -- barrel export (~5 lines)
- `packages/cli/src/commands/cron-start.ts` -- long-running process entry (~60 lines)

**Files to modify (1):**
- `packages/cli/bin/stark.ts` -- implement the existing `cron` command (already registered at line 21 as `{ name: "cron", description: "Manage scheduled tasks and automation" }` but falls through to "not yet implemented" in the switch). Wire to `cron-start.ts`. Do NOT create a separate `scheduler` command name.

**Files to create (test, 1):**
- `packages/core/tests/scheduler.test.ts` (~60 lines)

**Estimated new lines:** ~225

**Acceptance Criteria:**
- [ ] Evening callback fires at configured time (default 20:00 IST) on trading days only
- [ ] Morning callback fires at configured time (default 09:00 IST) on trading days only
- [ ] Sync fires every N minutes during market hours (9:15-15:30) on trading days
- [ ] Weekends and NSE holidays skipped
- [ ] Duplicate runs within same day prevented
- [ ] All events logged to `automation_log`
- [ ] `stark cron` keeps running indefinitely (suitable for systemd)
- [ ] Scheduler uses `createPersistentCommandContext()` from Step 1 (not `createCommandContext()`)
- [ ] On startup, logs a WARNING if the current year does not match the hardcoded holiday list AND `config.scheduler?.nseHolidays` is empty or absent (year-validity guard)

**Risk:** Timezone handling (IST = UTC+5:30) must be correct. Mitigation: use explicit `Intl.DateTimeFormat` with `Asia/Kolkata` timezone, not system TZ.

---

### Step 5: Proactive Notifications (Scheduler -> Telegram)

**Objective:** Push scheduled workflow results to user's Telegram chat.

**Files to create (3):**
- `packages/core/src/notifications/channel.ts` -- `NotificationChannel` interface (Seam 3, ~15 lines)
- `packages/core/src/notifications/telegram-notifier.ts` -- Telegram implementation (~50 lines)
- `packages/core/src/notifications/index.ts` -- barrel export (~5 lines)

**Files to modify (1):**
- `packages/cli/src/commands/cron-start.ts` -- wire notifier into scheduler callbacks

**Estimated new lines:** ~70

**Acceptance Criteria:**
- [ ] Evening workflow pushes focus list summary to Telegram
- [ ] Morning workflow pushes update only when changes detected
- [ ] Sync pushes notification only when new entries/exits found
- [ ] Heat warning pushed when exceeding threshold
- [ ] Unreachable Telegram fails silently (logged, not thrown)
- [ ] Missing `allowedChatIds` means notifications silently skipped

---

### Step 6: RPi Deployment + Testing + Documentation

**Objective:** Deploy on Pi, write remaining tests for new code, document setup.

**Files to create (4):**
- `packages/telegram/tests/executor.test.ts` -- command execution tests (~80 lines)
- `scripts/ups-monitor.sh` -- UPS battery monitor (~25 lines)
- `docs/RPI_DEPLOYMENT.md` -- hardware + software + systemd + UPS setup guide (~200 lines)
- `docs/TELEGRAM_SETUP.md` -- BotFather + chat ID + config guide (~80 lines)

**Estimated new lines:** ~385

**This step is partially manual (Pi setup) and partially code (tests + docs).**

**Note:** NLU parsing tests were moved to Step 3 (co-located with implementation).

**Acceptance Criteria:**
- [ ] Executor tests verify correct core function calls
- [ ] Pi boots and both systemd services (`stark-telegram`, `stark-cron`) start automatically
- [ ] UPS monitor triggers clean shutdown on low battery
- [ ] `git pull && bun install && systemctl restart` updates cleanly
- [ ] All existing 184 tests still pass
- [ ] Deployment docs are complete and accurate

---

## Minimum Viable Path (Dev Machine First)

The plan is designed so **Steps 1-3 are sufficient for a working Telegram bot on the dev machine.** Steps 4-5 add automation. Step 6 is Pi-specific deployment.

**MVP milestone:** After Steps 1-3, the user can:
- Message the Telegram bot from their phone
- "Score RELIANCE" and get a formatted 13-factor breakdown
- "Show focus list" and see tonight's scored stocks
- "Override its linearity to 1" (multi-turn context)
- Run `stark sync` from CLI to auto-journal broker positions

**Automation milestone:** After Steps 4-5, the scheduler runs evening/morning workflows unattended and pushes results to Telegram.

**Deployment milestone:** Step 6 puts everything on the Pi with systemd auto-restart and UPS resilience.

---

## File Count Summary

| Step | New Files | Modified Files | New Lines (est) |
|------|-----------|----------------|-----------------|
| 1 | 0 | 6 | ~200 |
| 2 | 3 | 4 | ~280 |
| 3 | 13 | 0 | ~1,035 |
| 4 | 4 | 1 | ~225 |
| 5 | 3 | 1 | ~70 |
| 6 | 4 | 0 | ~385 |
| **Total** | **27** | **12** | **~2,195** |

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Angel One portfolio API endpoint undocumented | MEDIUM | Step 2 blocked | Use document-specialist to fetch API docs; MockProvider allows parallel test development |
| Telegram MarkdownV2 escaping bugs | HIGH | Garbled bot messages | Dedicated `escapeMarkdownV2()` utility with comprehensive test cases |
| SQLite SQLITE_BUSY under concurrent access | LOW (after fix) | Data corruption or crashes | `busy_timeout = 5000` pragma; WAL mode already enabled |
| IST timezone miscalculation in scheduler | MEDIUM | Workflows fire at wrong time | Use `Intl.DateTimeFormat` with explicit `Asia/Kolkata`; unit tests with fixed time |
| GeminiClient NLU adds latency | LOW | Slow bot responses | Exact regex matching handles 80%+ of messages; Gemini only for ambiguous input |
| Migration v2 breaks existing databases | LOW | Data loss | `CREATE TABLE IF NOT EXISTS`; test migration on existing DB before release |
| Bun ARM64 compatibility on RPi | LOW | Can't run on Pi | Bun officially supports aarch64 Linux; verify during Step 6 |
| Trading calendar year-validity | MEDIUM | Scheduler skips valid trading days or runs on holidays after year rollover | Scheduler logs WARNING on startup if current year does not match hardcoded holiday list and `config.scheduler?.nseHolidays` is empty; user must update config annually |
| TOTP auth overhead in long-running processes | LOW (after fix) | Re-authenticates on every Telegram message | `createPersistentCommandContext()` caches provider; `refreshAuth()` only when session expires |

---

## Extensibility Seams (6 total, ~1 hour extra effort)

All seams are interfaces/columns built during Steps 1, 3, and 5. They cost minimal effort now and enable future platform expansion:

1. **MessagePlatform interface** (Step 3) -- future WhatsApp, Discord adapters
2. **`platform` column on chat_sessions** (Step 1) -- per-platform conversation history (trivial: 5 chars of SQL in CREATE TABLE)
3. **NotificationChannel interface** (Step 5) -- future WhatsApp, Discord, email notifiers
4. **ToolRegistry with `toMCPTools()`** (Step 3) -- future MCP server for Claude Desktop/Cursor
5. **Platform-agnostic NLU** (Step 3) -- takes plain strings, not platform objects
6. **Structured ToolResult** (Step 3) -- executor returns data, formatter is per-platform

**Deferred:** `notification_preferences` config (originally Seam 6) -- adds types that won't be used yet. The scheduler can check `config.telegram?.botToken` directly for now. Revisit when a second notification platform is added.

---

## Success Criteria (Definition of Done)

1. `bun run packages/telegram/bin/stark-telegram.ts` connects and responds to messages
2. "Score RELIANCE" via Telegram returns formatted factor breakdown within 30s
3. "Show focus list" after evening run returns tonight's scored stocks
4. Multi-turn context: "score INFY" then "override its linearity to 1" works
5. `stark cron` runs evening workflow at 20:00 IST on trading days, pushes to Telegram
6. `stark sync` detects new broker positions and auto-logs entries via `TradeManager`
7. Both services run on RPi 4 via systemd, survive reboot, auto-restart on crash
8. UPS monitor triggers clean shutdown before batteries die
9. All existing 184 tests pass unchanged
10. New code has tests for NLU (Step 3), executor (Step 6), portfolio sync (Step 2), and scheduler (Step 4)
