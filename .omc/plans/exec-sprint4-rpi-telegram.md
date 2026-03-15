# Execution Plan: Sprint 4 -- RPi + Telegram

**Date:** 2026-03-12
**Source:** `.omc/plans/plan-rpi-telegram.md` (approved design plan)
**Status:** Revised (Architect+Critic iteration 1) -- ready for execution via `/ralph`
**Baseline:** 257 tests pass on master, 0 failures

---

## RALPLAN-DR Summary

### Principles

1. **Sequential foundation, parallel features** -- Step 1 (DB+Config+LLM+PersistentContext) must merge first. Steps 2 and 3 can then run in parallel worktrees.
2. **One worktree per logical boundary** -- Separate worktrees for core extensions (Step 1), portfolio sync (Step 2), telegram package (Step 3), and scheduler+notifications (Steps 4-5). Step 6 is docs/scripts on master after all merges.
3. **Test on NTFS, edit on exFAT** -- All worktrees live under `/mnt/d/`. Before running tests, copy to `/mnt/c/Projects/SteveTrading` (or a temp NTFS path). Use `rsync --delete` for clean copies.
4. **No regression tolerance** -- Every merge must preserve all 257+ existing tests. Run full suite after each merge.
5. **MockProvider-first development** -- Steps 2 and 3 use MockProvider for all broker interactions. Real API endpoints are validated separately via document-specialist.

### Decision Drivers (Top 3)

1. **Merge conflict minimization** -- Steps 2 and 3 modify different files (Step 2: `data-provider.ts`, `angel-one.ts`, `mock-provider.ts`, `stark.ts`; Step 3: creates new package). No overlap.
2. **Step 1 is the critical path** -- Every subsequent step depends on migration v2, `LLMService.complete()`, `PersistentCommandContext`, and new config types. It must be small, correct, and merged fast.
3. **Telegram package isolation** -- `packages/telegram/` is a new workspace with zero modifications to existing files. It can be developed in a worktree and merged cleanly.

### Viable Options

**Option A: 3 worktrees, sequential merge (CHOSEN)**
- Worktree 1: `sprint4-foundation` (Step 1) -- merge first
- Worktree 2: `sprint4-sync` (Step 2) -- branch from merged Step 1
- Worktree 3: `sprint4-telegram` (Steps 3+4+5) -- branch from merged Step 1
- Step 6: directly on master after all merges

**Pros:** Clean dependency chain; no rebase required; each worktree is self-contained.
**Cons:** Steps 2 and 3 cannot start until Step 1 merges (serial bottleneck of ~200 lines).

**Option B: 4 worktrees, speculative parallel start (VIABLE ALTERNATIVE)**
- Start Steps 2 and 3 in parallel with Step 1 by stubbing the Step 1 interfaces locally.
- Rebase onto merged Step 1 before merge.

**Pros:** Maximum parallelism.
**Cons:** Rebase risk; duplicated interface stubs; more complex coordination.

**Why Option A chosen:** Step 1 is ~200 lines modifying 6 files -- it can be completed and merged in one focused session. The serial delay is minimal. Option B's rebase overhead is not justified.

### ADR

- **Decision:** 3 worktrees with sequential merge order
- **Drivers:** Merge safety, Step 1 critical path size (~200 lines), zero rebase needed
- **Alternatives considered:** 4 parallel worktrees with speculative stubs (rebase risk not justified)
- **Consequences:** Steps 2/3 blocked until Step 1 merges; compensated by Step 1's small size
- **Follow-ups:** If Step 1 takes longer than expected, consider Option B for Step 3 (telegram is fully isolated)

---

## Worktree Strategy

```
master (257 tests)
  |
  +-- git worktree add ../SteveTrading-sprint4-foundation sprint4-foundation
  |     Step 1: DB + Config + LLM.complete() + PersistentCommandContext
  |     ~200 lines, 6 modified files, 0 new files
  |     >> MERGE TO MASTER (fast-forward preferred)
  |
  +-- git worktree add ../SteveTrading-sprint4-sync sprint4-sync
  |     Step 2: Portfolio Sync
  |     ~280 lines, 3 new files, 4 modified files
  |     >> MERGE TO MASTER
  |
  +-- git worktree add ../SteveTrading-sprint4-telegram sprint4-telegram
        Steps 3 + 4 + 5: Telegram Bot + Scheduler + Notifications
        ~1,330 lines, 20 new files, 2 modified files
        Sequential within worktree: Step 3 -> Step 4 -> Step 5
        >> MERGE TO MASTER
```

**Step 6** (RPi deployment docs, UPS monitor, executor tests) runs directly on master after all merges.

### Worktree Commands

```bash
# From /mnt/d/Projects/SteveTrading
git worktree add ../SteveTrading-sprint4-foundation -b sprint4-foundation
git worktree add ../SteveTrading-sprint4-sync -b sprint4-sync          # after Step 1 merges
git worktree add ../SteveTrading-sprint4-telegram -b sprint4-telegram  # after Step 1 merges
```

### Test Execution Pattern

For every worktree, before running tests:
```bash
# Sync worktree to NTFS test mirror
rsync -a --delete /mnt/d/Projects/SteveTrading-sprint4-{name}/ /mnt/c/Projects/SteveTrading/ \
  --exclude node_modules --exclude .git
# Then run from NTFS
cd /mnt/c/Projects/SteveTrading && bun test packages/core/tests/
```

For the telegram package tests (Step 3), also run:
```bash
cd /mnt/c/Projects/SteveTrading && bun test packages/telegram/tests/
```

---

## Step-by-Step Implementation

---

### STEP 1: Foundation (Worktree: `sprint4-foundation`)

**Branch:** `sprint4-foundation` from `master`
**Goal:** Add migration v2, config types, busy_timeout, LLMService.complete(), PersistentCommandContext
**Estimated:** ~200 new/modified lines across 6 files

#### 1.1 DB Schema Migration v2

**File:** `packages/core/src/db/schema.ts`

**Changes:**
- Bump `SCHEMA_VERSION` from `1` to `2`
- Add second entry to `MIGRATIONS` array with `version: 2`
- Migration v2 SQL creates two tables:

```sql
-- Automation Log
CREATE TABLE IF NOT EXISTS automation_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('success', 'failure', 'skipped')),
  details TEXT,
  triggered_by TEXT NOT NULL DEFAULT 'scheduler',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_automation_log_created
  ON automation_log(created_at);

-- Chat Sessions
CREATE TABLE IF NOT EXISTS chat_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'telegram',
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  message TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_chat_sessions_chat_id
  ON chat_sessions(chat_id, created_at);
```

**Acceptance criteria:**
- [ ] `SCHEMA_VERSION === 2`
- [ ] Fresh DB gets both v1 and v2 tables
- [ ] Existing v1 DB migrates cleanly (v2 uses `CREATE TABLE IF NOT EXISTS`)
- [ ] `schema_version` table records version 2 after migration

#### 1.2 SQLite busy_timeout

**File:** `packages/core/src/db/adapter.ts`

**Changes:**
- Add `this.db.exec('PRAGMA busy_timeout = 5000;');` on line 30 (after the WAL pragma)

**Acceptance criteria:**
- [ ] `PRAGMA busy_timeout` returns `5000` when queried on a new DB
- [ ] All 257 existing tests still pass (busy_timeout is harmless for single-process tests)

#### 1.3 Config Extension

**File:** `packages/core/src/config/index.ts`

**Changes:**
- Add `TelegramConfig` interface: `{ botToken: string; allowedChatIds: number[] }`
- Add `SchedulerConfig` interface: `{ eveningTime?: string; morningTime?: string; syncIntervalMinutes?: number }` (NOTE: `nseHolidays` is NOT included here -- it already exists on `StarkConfig` at top level. The scheduler reads `config.nseHolidays` directly.)
- Add optional fields to `StarkConfig`: `telegram?: TelegramConfig`, `scheduler?: SchedulerConfig`
- Do NOT change `getDefaultConfig()` -- these fields are optional

**Acceptance criteria:**
- [ ] `StarkConfig` type accepts `telegram` and `scheduler` fields
- [ ] Existing configs without these fields still load correctly
- [ ] `getDefaultConfig()` does NOT include telegram/scheduler (they are opt-in)

#### 1.4 New Query Methods

**File:** `packages/core/src/db/queries.ts`

**Changes:**
Add 5 new methods to the `Queries` class (at the end, before closing brace):

- `insertChatMessage(chatId: string, platform: string, role: 'user' | 'assistant', message: string): void`
- `getRecentChatMessages(chatId: string, limit?: number): Array<{ role: string; message: string; createdAt: string }>` (default limit=10, ordered ASC)
- `trimChatHistory(chatId: string, keepLast: number): void` (DELETE oldest beyond keepLast)
- `insertAutomationLog(action: string, status: 'success' | 'failure' | 'skipped', details?: string, triggeredBy?: string): void`
- `getAutomationLogs(limit?: number): Array<{ action: string; status: string; details: string | null; triggeredBy: string; createdAt: string }>` (default limit=50, ordered DESC)

**Acceptance criteria:**
- [ ] All 5 methods execute without SQL errors on a migrated DB
- [ ] `getRecentChatMessages` returns messages in chronological order (ASC)
- [ ] `trimChatHistory(chatId, 10)` keeps exactly the last 10 messages for that chat
- [ ] `getAutomationLogs` returns newest first (DESC)

#### 1.5 LLMService.complete()

**File:** `packages/core/src/llm/llm-service.ts`

**Changes:**
- Add `complete(prompt: string): Promise<string>` to `LLMService` interface
- Add `canComplete(): boolean` to `LLMService` interface
- Implement in `LLMServiceImpl`:
  - `canComplete()`: returns `true` if `this.gemini !== null || this.claude !== null`
  - `complete()`: Uses Gemini first (cheaper/faster for text classification). Falls back to Claude.
  - Gemini path: call `fetch()` to `models/gemini-2.0-flash:generateContent` with the prompt as plain text (no JSON response format -- just return the text content). No caching (NLU prompts are unique).
  - Add a code comment: `// Gemini-first (unlike analyzeOHLCV which is Claude-first) -- NLU classification is latency-sensitive and low-complexity, making Gemini 2.0 Flash the better choice for speed/cost.`
  - Claude fallback: call `fetch()` to Anthropic messages API with the prompt. No caching.
  - Return the raw text response string.

**File:** `packages/core/src/llm/index.ts`
- No changes needed (already exports `LLMService` and `LLMServiceImpl`)

**Acceptance criteria:**
- [ ] `LLMService` interface has `complete()` and `canComplete()` methods
- [ ] `canComplete()` returns `true` when Gemini or Claude is configured
- [ ] `canComplete()` returns `false` when neither is configured
- [ ] `complete()` returns a string (not JSON-structured LLMAnalysisResult)
- [ ] `complete()` tries Gemini first, falls back to Claude on error
- [ ] No caching for `complete()` calls

#### 1.6 Make `EntryInput.stopPrice` Optional (Architect/Critic MUST FIX)

**File:** `packages/core/src/journal/trade-manager.ts`

**Changes:**
- Change `EntryInput.stopPrice` from `number` to `number | undefined`
- In `entry()` method: wrap risk calculation in a conditional:
  ```typescript
  const riskPerShare = input.stopPrice !== undefined ? input.entryPrice - input.stopPrice : 0;
  const riskAmount = input.stopPrice !== undefined ? riskPerShare * input.shares : undefined;
  ```
- Pass `riskAmount ?? null` to the DB insert (already handles `undefined` → `null`)

**Why:** With `stopPrice: 0`, `riskPerShare = entryPrice - 0 = entryPrice`, inflating risk to the full position value. This corrupts portfolio heat calculations and R-multiples. PortfolioSync (Step 2) passes `stopPrice: undefined` for auto-synced trades.

**Acceptance criteria:**
- [ ] `EntryInput.stopPrice` is `number | undefined`
- [ ] `entry()` with `stopPrice: undefined` stores `null` in DB and sets `riskAmount` to `null`
- [ ] `entry()` with `stopPrice: 100` still computes risk correctly
- [ ] Existing tests still pass (update test fixtures that pass `stopPrice: 0` to pass a real value or `undefined`)

---

#### 1.7 PersistentCommandContext

**File:** `packages/cli/src/utils/command-context.ts`

**Changes:**
- Add `PersistentCommandContext` interface extending `CommandContext`:
  ```typescript
  export interface PersistentCommandContext extends CommandContext {
    dispose(): void;
    refreshAuth(): Promise<void>;
    isHealthy(): boolean;
  }
  ```
- Add `createPersistentCommandContext()` function:
  - Same setup as `createCommandContext()` but stores references for reuse
  - `dispose()` calls `db.close()`
  - `refreshAuth()` calls `sessionManager.ensureAuthenticated(config)` only if `!provider.isAuthenticated()`. On re-auth, rebuilds the FULL chain: `provider`, `engine` (takes provider), `breadthCalc` (takes provider+db), `mbiManager` (takes db+breadthCalc). LLMService does NOT need rebuilding (uses db+fetch, not provider).
  - `isHealthy()` returns `true` if DB connection is alive (try a `SELECT 1`) and provider session is not expired. Callers should check this before processing and call `refreshAuth()` or recreate context if unhealthy.
  - Caches `db`, `queries`, `provider`, `llmService`, `engine`, `mbiManager` as mutable state
  - The existing `createCommandContext()` remains unchanged

**Acceptance criteria:**
- [ ] `createPersistentCommandContext()` returns a `PersistentCommandContext`
- [ ] Calling it once and accessing `.db`, `.queries` multiple times returns the same instance
- [ ] `dispose()` closes the DB connection
- [ ] `refreshAuth()` only re-authenticates when the provider's session is expired
- [ ] `refreshAuth()` rebuilds provider, engine, breadthCalc, and mbiManager on re-auth
- [ ] `isHealthy()` returns `true` for a fresh context and `false` when DB is closed
- [ ] Existing `createCommandContext()` behavior is unchanged
- [ ] All 257 existing tests still pass

#### 1.7 Tests for Step 1

**File:** `packages/core/tests/db.test.ts` (extend existing file)

**New tests to add:**
- Migration v2 creates `automation_log` and `chat_sessions` tables
- `insertChatMessage` + `getRecentChatMessages` round-trip
- `trimChatHistory` keeps only the last N messages
- `insertAutomationLog` + `getAutomationLogs` round-trip
- `busy_timeout` pragma is set to 5000

**File:** `packages/core/tests/llm-service.test.ts` (extend existing file)

**New tests to add:**
- `canComplete()` returns true when Gemini key is configured
- `canComplete()` returns false when no keys configured
- `complete()` calls Gemini API (mock fetch)
- `complete()` falls back to Claude when Gemini fails (mock fetch)

**Estimated new test lines:** ~80

**Acceptance criteria:**
- [ ] All new tests pass
- [ ] All 257 existing tests still pass
- [ ] Total test count: ~265+

#### MERGE Step 1

```bash
cd /mnt/d/Projects/SteveTrading
git merge sprint4-foundation --no-ff -m "Sprint 4 Step 1: DB migration v2, config extension, LLMService.complete(), PersistentCommandContext"
```

**Post-merge verification:**
- [ ] All tests pass from `/mnt/c/Projects/SteveTrading`
- [ ] `SCHEMA_VERSION === 2`
- [ ] Fresh DB has all 14 tables (12 v1 + 2 v2)

---

### STEP 2: Portfolio Sync (Worktree: `sprint4-sync`)

**Branch:** `sprint4-sync` from `master` (after Step 1 merged)
**Goal:** `stark sync` command + PortfolioSync class + fetchPositions()
**Estimated:** ~280 new lines, 3 new files, 4 modified files

#### 2.1 DataProvider.fetchPositions()

**File:** `packages/core/src/api/data-provider.ts`

**Changes:**
- Add `BrokerPosition` interface:
  ```typescript
  export interface BrokerPosition {
    symbol: string;
    token: string;
    exchange: string;
    quantity: number;
    averagePrice: number;
    lastPrice: number;
    pnl: number;
    productType: string; // 'CNC' for delivery, 'INTRADAY' for intraday
  }
  ```
- Add to `DataProvider` interface: `fetchPositions(): Promise<BrokerPosition[]>`

#### 2.2 AngelOneProvider.fetchPositions()

**File:** `packages/core/src/api/angel-one.ts`

**Changes:**
- Implement `fetchPositions()`: calls Angel One holdings API endpoint
- Endpoint: `GET /rest/secure/angelbroking/portfolio/v1/getAllHolding` (needs verification via document-specialist)
- Maps response to `BrokerPosition[]`
- Filters to `productType === 'CNC'` (delivery only, not intraday positions)

**Note:** The exact endpoint and response shape must be verified. Use the document-specialist agent to fetch Angel One Smart API docs for the holdings endpoint. If API docs are unavailable, implement with best-guess endpoint and add a TODO comment.

#### 2.3 MockProvider.fetchPositions()

**File:** `packages/core/src/api/mock-provider.ts`

**Changes:**
- Add `fetchPositions()` returning fixture data:
  ```typescript
  async fetchPositions(): Promise<BrokerPosition[]> {
    return [
      { symbol: 'RELIANCE', token: '2885', exchange: 'NSE', quantity: 100, averagePrice: 2450, lastPrice: 2500, pnl: 5000, productType: 'CNC' },
      { symbol: 'TCS', token: '11536', exchange: 'NSE', quantity: 50, averagePrice: 3800, lastPrice: 3850, pnl: 2500, productType: 'CNC' },
    ];
  }
  ```

#### 2.4 PortfolioSync Class

**New file:** `packages/core/src/journal/portfolio-sync.ts`

**Design:**
- Constructor takes `TradeManager`, `DataProvider`, `Queries`, optional logger
- `sync(): Promise<SyncResult>` method:
  1. Fetch broker positions via `provider.fetchPositions()`
  2. Fetch open trades via `queries.getOpenTrades()`
  3. Diff:
     - Positions in broker but NOT in Stark open trades -> call `tradeManager.entry()` with `conviction: 'MEDIUM'`, `stopPrice: undefined` (Step 1.6 makes this optional; risk math is skipped, `riskAmount` stored as `null`)
     - Open trades in Stark but NOT in broker positions -> call `tradeManager.exit()` with `exitReason: 'DISCRETION'`, `exitPrice: position.lastPrice`
     - Partial quantity changes -> log WARNING, do NOT auto-process
  4. Log all actions to `automation_log` via `queries.insertAutomationLog()`
  5. Return `SyncResult` with counts and warnings

- `SyncResult` interface:
  ```typescript
  interface SyncResult {
    newEntries: Array<{ symbol: string; shares: number; entryPrice: number }>;
    autoExits: Array<{ symbol: string; exitPrice: number; pnl: number }>;
    warnings: string[];
    alreadySynced: number;
  }
  ```

- **Idempotency:** Before calling `tradeManager.entry()`, check if an open trade already exists for that symbol (it will throw if duplicate -- catch and count as `alreadySynced`)
- **Trade type marker:** Use `tradeType: 'swing'` for synced trades. The plan's suggestion to add a `'sync'` trade type would require schema migration -- instead, log the sync origin in `automation_log`

**Estimated:** ~120 lines

#### 2.5 stark sync CLI Command

**New file:** `packages/cli/src/commands/sync.ts`

**Design:**
- Uses `createCommandContext()` (not persistent -- this is a one-shot CLI command)
- Creates `TradeManager` and `PortfolioSync`
- Calls `portfolioSync.sync()`
- Prints summary table:
  ```
  Portfolio Sync Complete
  - New entries: 2 (RELIANCE, TCS) -- set stop prices with `stark exit --override`
  - Auto exits: 1 (ITC)
  - Warnings: 1 (SBIN: quantity mismatch, skipped)
  ```

**Estimated:** ~40 lines

**File:** `packages/cli/bin/stark.ts`

**Changes:**
- Add `sync` to COMMANDS array: `{ name: "sync", description: "Sync broker positions with trade journal" }`
- Add case in switch:
  ```typescript
  case "sync": {
    const { syncCommand } = await import("../src/commands/sync.js");
    await syncCommand(commandArgs);
    break;
  }
  ```

#### 2.6 Tests for Step 2

**New file:** `packages/core/tests/portfolio-sync.test.ts`

**Tests (~80 lines):**
- Syncs new broker positions as trade entries (via MockProvider fixture data)
- Detects exited positions and auto-closes trades
- Skips already-synced positions (idempotency)
- Warns on partial quantity changes
- Logs all actions to `automation_log`
- Does not create duplicate entries on repeated sync

**Test setup pattern:** Same `createTestDb()` pattern as `trade-manager.test.ts` -- in-memory SQLite, apply all migrations, create TradeManager + PortfolioSync with MockProvider.

**Acceptance criteria:**
- [ ] `DataProvider` interface has `fetchPositions()` method
- [ ] `AngelOneProvider.fetchPositions()` exists (may have TODO for endpoint verification)
- [ ] `MockProvider.fetchPositions()` returns fixture data
- [ ] New broker positions auto-logged via `TradeManager.entry()` with `conviction: 'MEDIUM'`, `stopPrice: undefined` (risk math skipped, `riskAmount` stored as `null`)
- [ ] Exited positions auto-closed via `TradeManager.exit()` with `reason: 'DISCRETION'`
- [ ] Partial quantity changes produce warnings, not auto-processed
- [ ] Repeated sync does not create duplicates
- [ ] All actions logged to `automation_log`
- [ ] `stark sync` command registered and works
- [ ] All existing tests still pass

#### MERGE Step 2

```bash
cd /mnt/d/Projects/SteveTrading
git merge sprint4-sync --no-ff -m "Sprint 4 Step 2: Portfolio sync (stark sync, fetchPositions, PortfolioSync)"
```

---

### STEP 3: Telegram Bot Package (Worktree: `sprint4-telegram`)

**Branch:** `sprint4-telegram` from `master` (after Step 1 merged)
**Goal:** `packages/telegram/` with bot, NLU, executor, formatter, session management
**Estimated:** ~1,035 new lines, 13 new files

**This step has the most files but modifies ZERO existing files.** It is a pure additive new package.

#### 3.1 Package Setup

**New file:** `packages/telegram/package.json`
```json
{
  "name": "@stark/telegram",
  "version": "0.1.0",
  "private": true,
  "bin": { "stark-telegram": "./bin/stark-telegram.ts" },
  "dependencies": {
    "@stark/core": "workspace:*",
    "@stark/cli": "workspace:*"
  },
  "devDependencies": { "typescript": "^5.6.0" }
}
```

**New file:** `packages/telegram/tsconfig.json`
```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": { "outDir": "./dist", "rootDir": "." },
  "include": ["src/**/*", "bin/**/*"]
}
```

**Root `tsconfig.json` update:** Add path alias:
```json
"@stark/telegram": ["./packages/telegram/src"],
"@stark/telegram/*": ["./packages/telegram/src/*"]
```

**Root `package.json`:** No change needed -- `"workspaces": ["packages/*"]` auto-discovers `packages/telegram`.

Run `bun install` in worktree after creating `package.json` to link workspace.

#### 3.2 MessagePlatform Interface (Seam 1)

**New file:** `packages/telegram/src/platform.ts` (~30 lines)

```typescript
export interface IncomingMessage {
  chatId: number;
  text: string;
  messageId: number;
  fromId: number;
  fromName: string;
}

export interface MessagePlatform {
  start(): Promise<void>;
  stop(): void;
  sendMessage(chatId: number, text: string, parseMode?: string): Promise<void>;
  onMessage(handler: (msg: IncomingMessage) => Promise<void>): void;
}
```

#### 3.3 Telegram Platform Implementation (Seam 1)

**New file:** `packages/telegram/src/telegram-platform.ts` (~120 lines)

**Design:**
- Implements `MessagePlatform`
- Long-polling via `getUpdates` with `offset` tracking
- `sendMessage` via Telegram Bot API `sendMessage` endpoint
- Messages >4096 chars split into multiple messages
- `escapeMarkdownV2(text: string): string` utility (escape all 11 special chars: `_ * [ ] ( ) ~ > # + - | { } . !`)
- Exponential backoff on network errors (1s, 2s, 4s, 8s, max 30s)
- `allowedChatIds` whitelist check -- silently ignore messages from unauthorized chats
- `stop()` sets a running flag to false, breaking the poll loop

#### 3.4 Platform Factory

**New file:** `packages/telegram/src/platform-factory.ts` (~15 lines)

```typescript
import type { MessagePlatform } from './platform.js';
import { TelegramPlatform } from './telegram-platform.js';

export function createPlatform(type: 'telegram', config: { botToken: string; allowedChatIds: number[] }): MessagePlatform {
  if (type === 'telegram') return new TelegramPlatform(config.botToken, config.allowedChatIds);
  throw new Error(`Unknown platform: ${type}`);
}
```

#### 3.5 ToolRegistry (Seam 4)

**New file:** `packages/telegram/src/tool-registry.ts` (~60 lines)

**Design:**
```typescript
export interface StarkTool {
  name: string;
  description: string;
  examples: string[];       // NLU training examples
  execute(args: Record<string, string>, ctx: PersistentCommandContext): Promise<ToolResult>;
}

export interface ToolResult {
  data: unknown;             // Structured data for formatting
  summary: string;           // Human-readable one-liner
}

export class ToolRegistry {
  private tools: Map<string, StarkTool> = new Map();

  register(tool: StarkTool): void;
  get(name: string): StarkTool | undefined;
  getAll(): StarkTool[];
  getToolDescriptions(): string;  // For NLU prompt generation
  toMCPTools(): Array<{ name: string; description: string; inputSchema: object }>;  // Seam 4: future MCP server
}
```

#### 3.6 Executor (registers all tools)

**New file:** `packages/telegram/src/executor.ts` (~350 lines)

**Design:**
- `createToolRegistry(ctx: PersistentCommandContext): ToolRegistry`
- Registers tools for all existing CLI commands:
  - `score` -- score a symbol, returns factor breakdown
  - `focus` -- show focus list
  - `heat` -- portfolio heat
  - `trades` -- list trades (open/closed/all)
  - `entry` -- log trade entry
  - `exit` -- log trade exit
  - `status` -- account/position status
  - `market` -- market overview
  - `morning` -- run morning workflow
  - `evening` -- run evening workflow
  - `sync` -- portfolio sync (from Step 2)
  - `review` -- review/override scores
  - `performance` -- performance stats
  - `evolve` -- scoring evolution
  - `import` -- import data
  - `mbi-analyze` -- MBI analysis
  - `help` -- list available commands
  - `logs` -- view recent automation logs
- Each tool wraps the corresponding core function (NOT shelling out to CLI -- imports core directly)
- Returns structured `ToolResult` so formatter is decoupled

#### 3.7 NLU (Natural Language Understanding)

**New file:** `packages/telegram/src/nlu.ts` (~180 lines)

**Design:**
- `NLU` class with `parse(text: string, history: Array<{role: string, message: string}>): Promise<ParsedIntent>`
- `ParsedIntent`: `{ command: string; args: Record<string, string>; confidence: number }`
- **Phase 1 (regex exact match):** handles ~80% of messages
  - Patterns: `score SYMBOL`, `focus list`, `show heat`, `open trades`, `my trades`, `market overview`, `help`, `sync`, `evening`, `morning`, `entry SYMBOL at PRICE qty SHARES stop STOP`, etc.
  - Case-insensitive matching
  - Symbol extraction via uppercase word after command keyword
- **Phase 2 (Gemini fallback):** for ambiguous messages
  - Uses `LLMService.complete()` from Step 1
  - Prompt includes tool descriptions from `ToolRegistry.getToolDescriptions()`
  - Prompt includes conversation history for multi-turn pronoun resolution ("override its linearity")
  - Returns JSON: `{ "command": "score", "args": { "symbol": "TATAELXSI" } }`
  - Confidence threshold: <0.3 = "I'm not sure what you mean, try: ..."
- **Multi-turn context:**
  - Track last referenced symbol per chat
  - "score INFY" -> sets lastSymbol = "INFY"
  - "override its linearity to 1" -> resolves "its" to "INFY" from history

#### 3.8 TelegramFormatter

**New file:** `packages/telegram/src/formatter.ts` (~160 lines)

**Design:**
- `TelegramFormatter` class (Seam 7: per-platform formatting)
- `format(toolName: string, result: ToolResult): string`
- Formats ToolResult data into Telegram MarkdownV2
- Dedicated formatters per tool:
  - `formatScore(data)` -- factor table with emoji indicators
  - `formatFocusList(data)` -- ranked stock list
  - `formatHeat(data)` -- heat gauge with warning levels
  - `formatTrades(data)` -- trade list with P&L
  - `formatDefault(data)` -- JSON fallback for unhandled tools
- Uses `escapeMarkdownV2()` from telegram-platform for all user data
- Truncates long outputs and adds "... (N more)" indicators

#### 3.9 ChatSessionManager

**New file:** `packages/telegram/src/session.ts` (~40 lines)

**Design:**
- Wraps `Queries.insertChatMessage()` and `Queries.getRecentChatMessages()`
- `recordMessage(chatId: number, role: 'user' | 'assistant', message: string): void`
- `getHistory(chatId: number): Array<{role: string, message: string}>`
- `cleanup(chatId: number): void` -- calls `trimChatHistory(chatId, 10)`
- Platform: always `'telegram'` (Seam 2: future platforms pass their own)

#### 3.10 Bot Entry Point

**New file:** `packages/telegram/src/index.ts` (~50 lines)

**Design:**
- Wires together: platform + NLU + executor + sessions + formatter
- Message handler flow:
  1. Receive message from platform
  2. Call `await ctx.refreshAuth()` (re-authenticates if session expired; critical for 24/7 process)
  3. Record user message in session
  4. Parse intent via NLU (with history from session)
  4. Execute via ToolRegistry
  5. Format result via TelegramFormatter
  6. Send response via platform
  7. Record assistant response in session
  8. Cleanup session (trim to last 10)
- Error handling: catch all errors, send user-friendly error message, log full error

**New file:** `packages/telegram/bin/stark-telegram.ts` (~10 lines)

**Design:**
- Entry point for systemd service
- Loads config via `loadConfig()`
- Validates `config.telegram?.botToken` exists
- Creates `PersistentCommandContext` via `createPersistentCommandContext()`
- Starts bot
- Handles SIGTERM/SIGINT: calls `context.dispose()` and `platform.stop()`

#### 3.11 Tests for Step 3

**New file:** `packages/telegram/tests/nlu.test.ts` (~100 lines)

**Tests:**
- Exact match: "score RELIANCE" -> `{ command: 'score', args: { symbol: 'RELIANCE' } }`
- Exact match: "focus list" -> `{ command: 'focus', args: {} }`
- Exact match: "open trades" -> `{ command: 'trades', args: { filter: 'open' } }`
- Exact match: "my heat" -> `{ command: 'heat', args: {} }`
- Exact match: "help" -> `{ command: 'help', args: {} }`
- Case insensitive: "Score reliance" works
- Unknown input with no LLM: returns low confidence
- Multi-turn symbol resolution: after "score INFY", "override its linearity" targets INFY

**These are pure string-in/intent-out tests.** No external dependencies, no LLM calls, no DB. The NLU regex matching path is tested directly.

**Acceptance criteria:**
- [ ] `packages/telegram/` is a valid Bun workspace (auto-discovered)
- [ ] `bun run packages/telegram/bin/stark-telegram.ts` starts (with valid config)
- [ ] `allowedChatIds` whitelist rejects unauthorized chats
- [ ] Exact matching works for core commands
- [ ] Multi-turn pronoun resolution works for "its/that/this"
- [ ] Messages >4096 chars are split
- [ ] Network errors trigger exponential backoff reconnect
- [ ] NLU test suite passes (pure string tests)
- [ ] Bot uses `createPersistentCommandContext()` (not `createCommandContext()`)
- [ ] 6 extensibility seams are present (MessagePlatform, platform column, ToolRegistry+toMCPTools, platform-agnostic NLU, structured ToolResult, per-platform formatter)

---

### STEP 4: Scheduler Service (Same worktree: `sprint4-telegram`)

**Goal:** TradingScheduler class + `stark cron` implementation
**Estimated:** ~225 new lines, 4 new files, 1 modified file

#### 4.1 TradingScheduler

**New file:** `packages/core/src/scheduler/scheduler.ts` (~100 lines)

**Design:**
- `TradingScheduler` class
- Constructor: `(config: { eveningTime: string, morningTime: string, syncIntervalMinutes: number, nseHolidays: string[] })` (NOTE: `nseHolidays` comes from `config.nseHolidays` on `StarkConfig`, NOT from `SchedulerConfig` -- avoids duplication)
- `start(callbacks: SchedulerCallbacks): void` -- starts interval loop
- `stop(): void`
- `SchedulerCallbacks`: `{ onEvening: () => Promise<void>, onMorning: () => Promise<void>, onSync: () => Promise<void> }`
- **Time checking:** Uses `Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata' })` -- NEVER system TZ
- **Trading day logic:**
  - Skip weekends (Saturday=6, Sunday=0)
  - Skip dates in `nseHolidays` array
  - Log WARNING on startup if current year not represented in holidays list AND `nseHolidays` is empty
- **Duplicate run prevention:** Track last run date per callback type in memory. Skip if already ran today.
- **Sync window:** Only during market hours (9:15-15:30 IST) on trading days
- **Main loop:** `setInterval` every 60 seconds. Check if any callback should fire. This is simpler and more reliable than `setTimeout` to a specific time.

**New file:** `packages/core/src/scheduler/index.ts` (~5 lines)
- Barrel export

#### 4.2 stark cron Command

**New file:** `packages/cli/src/commands/cron-start.ts` (~60 lines)

**Design:**
- Uses `createPersistentCommandContext()` (long-running process)
- Creates `TradingScheduler` with config from `context.config.scheduler`
- Wires callbacks (each callback calls `await ctx.refreshAuth()` first to handle daily session expiry):
  - `onEvening`: `refreshAuth()` then imports and runs evening workflow logic
  - `onMorning`: `refreshAuth()` then imports and runs morning workflow logic
  - `onSync`: `refreshAuth()` then creates PortfolioSync and runs sync
- Logs all events to `automation_log`
- SIGTERM handler: `scheduler.stop()`, `context.dispose()`

**File:** `packages/cli/bin/stark.ts`

**Changes:**
- Add a new `case "cron":` block BEFORE the `default` case in the switch statement. The `cron` command already exists in the COMMANDS array (line 24) but currently falls through to the `default` "not yet implemented" handler. Add:
  ```typescript
  case "cron": {
    const { cronStartCommand } = await import("../src/commands/cron-start.js");
    await cronStartCommand(commandArgs);
    break;
  }
  ```

Note: `cron` is already registered in the COMMANDS array at line 24.

#### 4.3 Tests for Step 4

**New file:** `packages/core/tests/scheduler.test.ts` (~60 lines)

**Tests:**
- `isTradingDay()` returns false for weekends
- `isTradingDay()` returns false for dates in nseHolidays
- `isTradingDay()` returns true for normal weekdays
- `shouldFireCallback()` returns false if already ran today
- Time parsing with IST timezone produces correct hours
- Holiday year-validity warning fires when current year not in holidays list

**Acceptance criteria:**
- [ ] Evening callback fires at configured time on trading days only
- [ ] Morning callback fires at configured time on trading days only
- [ ] Sync fires every N minutes during market hours on trading days
- [ ] Weekends and holidays are skipped
- [ ] Duplicate runs within same day are prevented
- [ ] All events logged to `automation_log`
- [ ] `stark cron` keeps running indefinitely
- [ ] Scheduler uses `createPersistentCommandContext()`
- [ ] Year-validity warning logged when appropriate

---

### STEP 5: Proactive Notifications (Same worktree: `sprint4-telegram`)

**Goal:** NotificationChannel interface + TelegramNotifier + scheduler wiring
**Estimated:** ~70 new lines, 3 new files, 1 modified file

#### 5.1 NotificationChannel Interface (Seam 3)

**New file:** `packages/core/src/notifications/channel.ts` (~15 lines)

```typescript
export interface NotificationChannel {
  send(message: string): Promise<void>;
  isAvailable(): boolean;
}
```

**New file:** `packages/core/src/notifications/index.ts` (~5 lines)
- Barrel export

#### 5.2 TelegramNotifier

**New file:** `packages/core/src/notifications/telegram-notifier.ts` (~50 lines)

**Design:**
- Implements `NotificationChannel`
- Constructor: `(botToken: string, chatIds: number[])`
- `isAvailable()`: returns `true` if `botToken` is set and `chatIds.length > 0`
- `send(message: string)`: sends to ALL `chatIds` via Telegram Bot API `sendMessage`
- Errors are caught and logged (never thrown -- notifications are best-effort)
- If `chatIds` is empty, `send()` is a silent no-op

#### 5.3 Wire into Scheduler

**File:** `packages/cli/src/commands/cron-start.ts`

**Changes:**
- Create `TelegramNotifier` from `context.config.telegram` (if configured)
- In `onEvening` callback: after running evening workflow, call `notifier.send(summary)` with focus list summary
- In `onMorning` callback: after running morning workflow, only notify if changes detected
- In `onSync` callback: only notify if new entries or exits found
- If notifier is not available (no config), skip silently

**Acceptance criteria:**
- [ ] Evening workflow pushes focus list summary to Telegram
- [ ] Morning workflow pushes update only when changes detected
- [ ] Sync pushes notification only when new entries/exits found
- [ ] Unreachable Telegram fails silently (logged, not thrown)
- [ ] Missing `telegram` config means notifications silently skipped

#### MERGE Steps 3+4+5

```bash
cd /mnt/d/Projects/SteveTrading
git merge sprint4-telegram --no-ff -m "Sprint 4 Steps 3-5: Telegram bot, scheduler (stark cron), proactive notifications"
```

**Post-merge verification:**
- [ ] All existing tests pass
- [ ] NLU tests pass
- [ ] `packages/telegram/` is a valid workspace
- [ ] `stark cron` command works (replace "not yet implemented")

---

### STEP 6: RPi Deployment + Final Tests (Direct on master)

**Branch:** directly on `master` (or a short-lived `sprint4-deployment` branch)
**Goal:** Executor tests, deployment docs, UPS monitor
**Estimated:** ~385 lines, 4 new files

#### 6.1 Executor Tests

**New file:** `packages/telegram/tests/executor.test.ts` (~80 lines)

**Tests:**
- `score` tool calls ScoringEngine correctly and returns structured data
- `focus` tool returns focus list data
- `heat` tool returns heat data
- `help` tool returns all registered tool names
- Unknown tool returns error message
- Uses in-memory DB + MockProvider (no external dependencies)

#### 6.2 Deployment Documentation

**New file:** `docs/RPI_DEPLOYMENT.md` (~200 lines)

**Sections:**
- Hardware requirements (RPi 4 4GB+, USB SSD, Waveshare UPS HAT)
- Software prerequisites (Bun, git, systemd)
- Clone and install
- Config setup (`~/.stark/config.json` with telegram and scheduler sections)
- Systemd service files (2 units: `stark-telegram.service`, `stark-cron.service`)
- UPS HAT setup (I2C enable, monitor script install)
- Maintenance (git pull + bun install + systemctl restart)
- Troubleshooting

**New file:** `docs/TELEGRAM_SETUP.md` (~80 lines)

**Sections:**
- Create bot via BotFather
- Get bot token
- Get chat ID (via @userinfobot or getUpdates API)
- Add to `~/.stark/config.json`
- Test connection

#### 6.3 UPS Monitor Script

**New file:** `scripts/ups-monitor.sh` (~25 lines)

**Design:**
- Reads battery level via I2C from Waveshare UPS HAT
- If battery < 20%, initiates clean shutdown
- Designed to run as a systemd timer (every 5 minutes)
- Logs battery level to syslog

#### Final Verification

**Acceptance criteria for Sprint 4 completion:**
- [ ] All existing 257+ tests pass
- [ ] New tests pass: db (Step 1), llm-service (Step 1), portfolio-sync (Step 2), nlu (Step 3), executor (Step 6), scheduler (Step 4)
- [ ] `stark sync` works with MockProvider
- [ ] `stark cron` starts and runs (replace "not yet implemented")
- [ ] `packages/telegram/bin/stark-telegram.ts` starts with valid config
- [ ] ToolRegistry has entries for all 16+ CLI commands
- [ ] NLU regex handles: score, focus, heat, trades, help, sync, market, morning, evening
- [ ] Multi-turn context resolves pronouns
- [ ] Deployment docs are complete
- [ ] Total estimated new lines: ~2,195
- [ ] Total new files: ~27
- [ ] Total modified files: ~12

---

## Merge Order Summary

```
1. sprint4-foundation -> master   (Step 1: ~200 lines, 6 modified files)
2. sprint4-sync -> master         (Step 2: ~280 lines, 3 new + 4 modified)
3. sprint4-telegram -> master     (Steps 3-5: ~1,330 lines, 20 new + 2 modified)
4. Step 6 directly on master      (~385 lines, 4 new files)
```

Steps 2 and 3 can be developed in parallel (after Step 1 merges) since they modify different files.

---

## Risk Mitigations

| Risk | Mitigation |
|------|------------|
| Angel One portfolio API endpoint unknown | Use document-specialist agent to fetch Smart API docs before Step 2. MockProvider allows full test development regardless. Add TODO if endpoint unverified. |
| Telegram MarkdownV2 escaping bugs | Build `escapeMarkdownV2()` as a standalone function with dedicated test cases for all 11 special characters. Test with real Telegram before merging. |
| SQLite SQLITE_BUSY in concurrent access | `busy_timeout = 5000` added in Step 1. WAL already enabled. Test with concurrent reads/writes in scheduler test. |
| IST timezone miscalculation | Use `Intl.DateTimeFormat` with explicit `Asia/Kolkata`. Unit tests with fixed timestamps. Never use `Date.getHours()` (which uses system TZ). |
| Migration v2 breaks existing databases | Both tables use `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS`. Test migration on existing v1 DB fixture. |
| `complete()` adds latency to NLU | Gemini 2.0 Flash is fast (~200ms). Only called for ambiguous messages (~20% of inputs). Exact regex matching handles the majority. |
| Bun ARM64 on RPi 4 | Bun officially supports aarch64 Linux. Verify during Step 6 hardware setup. Fallback: Node.js runtime (but prefer Bun). |
| `stopPrice` for auto-synced trades | `EntryInput.stopPrice` is `number | undefined` (Step 1.6). PortfolioSync passes `undefined`; risk math skipped; `riskAmount` stored as `null`. The `stark sync` output tells user to set stop prices via `stark exit --override`. |
| Auth expiry in long-running processes | `PersistentCommandContext.refreshAuth()` called at the start of every scheduler callback and every telegram message handler. Rebuilds full provider→engine→mbiManager chain on re-auth. `isHealthy()` available for defensive checks. |
| Root tsconfig.json path alias update | Adding `@stark/telegram` paths is the only change to root config. No impact on existing packages. |

---

## Parallelization Opportunities for `/ralph`

When executing via `/ralph`, the following can run in parallel:

**After Step 1 merges:**
- **Agent A:** Step 2 (sprint4-sync worktree) -- portfolio sync
- **Agent B:** Step 3.1-3.4 (sprint4-telegram worktree) -- package setup + platform

**Within Step 3 (sequential within telegram worktree):**
- 3.5 (ToolRegistry) and 3.7 (NLU) can be developed in parallel by two agents if they agree on the `StarkTool` interface first
- 3.6 (Executor) depends on 3.5 (ToolRegistry)
- 3.8 (Formatter) depends on 3.6 (Executor's ToolResult shape)
- 3.10 (Entry point) depends on everything else

**After Steps 2 and 3 merge:**
- Step 4 (Scheduler) and Step 5 (Notifications) are sequential but small
- Step 6 (docs/tests) can start as soon as the code is feature-complete

---

## Test Count Projections

| Step | New Tests (est) | Running Total |
|------|----------------|---------------|
| Baseline | 0 | 257 |
| Step 1 | ~10 (db + llm-service) | ~267 |
| Step 2 | ~8 (portfolio-sync) | ~275 |
| Step 3 | ~10 (nlu) | ~285 |
| Step 4 | ~8 (scheduler) | ~293 |
| Step 5 | 0 (covered by scheduler tests) | ~293 |
| Step 6 | ~8 (executor) | ~301 |
| **Total** | **~44 new tests** | **~301** |
