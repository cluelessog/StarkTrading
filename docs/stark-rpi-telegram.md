# Plan: Stark-Trading RPi Deployment + Telegram Chat Interface

**Date:** 2026-03-10
**Status:** Ready for execution
**Complexity:** MEDIUM (well-scoped, builds on stable core)
**Scope:** ~20 new files, ~5 modified files, 1 new workspace package (`packages/telegram`), RPi deployment config

---

## RALPLAN-DR Summary

### Principles

1. **Reuse `@stark/core` entirely** -- The Telegram bot and scheduler are thin wrappers around the same `CommandContext`, `ScoringEngine`, `TradeManager`, `Queries`, and `LLMService` that the CLI uses. Zero duplication of business logic.
2. **No new infrastructure dependencies** -- No Redis, no message queues, no Docker. Just Bun, SQLite, systemd, and `fetch()` for the Telegram Bot API.
3. **Graceful degradation everywhere** -- If Gemini is down, NLU falls back to exact command matching. If Angel One auth fails, bot reports the error to the user. If the Pi loses internet, systemd restarts services when connectivity returns.
4. **Pi-first, not Pi-only** -- Everything built here also runs on the user's dev machine. The Pi is the deployment target, not a platform dependency.
5. **Observable** -- Every automated action (scheduled scoring, auto-sync, notifications) is logged to `automation_log` table. The user can ask the bot "what happened overnight" and get a complete audit trail.

### Decision Drivers (Top 3)

1. **Always-on requirement** -- The user wants evening/morning workflows to run unattended. A Raspberry Pi 4 (4GB) running 24/7 at ~5W is cheaper than any cloud hosting and has no free-tier limits.
2. **Chat-first UX** -- The user wants to interact with Stark from their phone via natural language. Telegram Bot API is free, requires no server (long-polling), and works on all platforms.
3. **Auto-journaling gap** -- Trades executed on Kite are not captured in Stark's journal unless manually logged. A periodic sync from Angel One portfolio API closes this gap.

### Viable Options

#### Option A: systemd + Telegram bot + periodic sync (CHOSEN)

Two systemd services: a scheduler (cron-like, fires evening/morning/sync) and a Telegram bot (always listening). Both import `@stark/core` directly. No daemon process, no event bus.

**Pros:**
- systemd handles restart-on-crash, boot-on-start, logging (journalctl)
- Each service is independently restartable
- Simpler than the `stark daemon` proposal (no file watcher needed on Pi)
- Standard Linux deployment pattern, well-documented

**Cons:**
- Two processes instead of one (negligible on Pi 4 with 4GB RAM)
- Requires systemd (RPi OS has it; WSL2 does not by default)

#### Option B: Single `stark daemon` with built-in Telegram (REJECTED)

Extend the existing `stark-automation.md` daemon plan to include Telegram bot in the same process.

**Why rejected:** Couples scheduling and chat into one process. If the Telegram long-poll hangs, it blocks the scheduler. If the scheduler crashes during scoring, the bot goes down. Separate services are more resilient for an always-on deployment. The daemon plan also includes a file watcher for TradingView CSV exports — irrelevant on the Pi since the user won't be saving CSVs there; they'll import via Telegram instead.

#### Option C: OpenClaw / Nanobot agent framework (REJECTED)

**Why rejected:** Stark is a single-purpose pipeline with 16 CLI commands. An agent framework solves multi-agent coordination, persistent context across platforms, and autonomous decision-making — none of which apply here. The Telegram NLU layer (Gemini command parsing + 10-message history) provides sufficient conversational context. Adding a 4,000+ line framework for what amounts to a command router is over-engineering.

### ADR

- **Decision:** Option A — systemd services + Telegram bot package + portfolio sync command
- **Drivers:** Always-on resilience, separation of concerns, standard Linux deployment
- **Alternatives considered:** Single daemon (rejected: coupling risk), agent framework (rejected: over-engineering)
- **Consequences:** Requires systemd (not available on WSL2 without workaround). User must create a Telegram bot via BotFather. RPi setup is a one-time manual process.
- **Follow-ups:** Phase 4 UI (Tauri/web) can run alongside these services unchanged since all share `@stark/core`.

---

## Context

Stark-Trading is a complete CLI tool with 10,400 lines of TypeScript across 110 files. All 13 scoring factors are implemented (8 algorithmic + 5 LLM-backed semi-discretionary). The trade journal, portfolio heat, performance analytics, scoring evolution, evening/morning workflows, and self-sufficient command pattern are all shipped.

The user has a Raspberry Pi 4 (4GB, 2020 model) that is currently unused. The goal is to deploy Stark on the Pi as an always-on service with:
1. Scheduled evening and morning workflows (no manual invocation)
2. A Telegram chat interface for all Stark commands (natural language + proactive notifications)
3. Automatic trade journaling from Angel One portfolio positions
4. UPS-backed power resilience with graceful shutdown

### Current State
- All CLI commands work via `createCommandContext()` pattern (auto-auth, auto-LLM, auto-DB)
- `SessionManager` handles TOTP auto-generation from stored seed
- `TradingCalendar` handles NSE holidays and weekends
- `automation_log` table exists (from `stark-automation.md` plan, schema migration v2)
- SQLite WAL mode is already enabled in `BunSQLiteAdapter` (adapter.ts line 29)
- `PRAGMA busy_timeout` may or may not be set — verify during implementation

### Hardware
- Raspberry Pi 4 Model B, 4GB RAM, ARM64
- Waveshare UPS HAT (B) with 2x 18650 cells (to be purchased)
- USB SSD boot recommended (SD card degradation under constant SQLite writes)

---

## Work Objectives

Deploy Stark on a Raspberry Pi 4 as an always-on service with Telegram chat interface, scheduled workflows, and automatic trade journaling.

---

## Guardrails

### Must Have
- `packages/telegram` is a new workspace package that imports `@stark/core` (no CLI dependency)
- Telegram bot uses long-polling (no webhook server, no public IP needed)
- NLU layer uses existing `GeminiClient` + `LLMCache` for command parsing
- Multi-turn conversation via per-chat-id message history (last 10 messages stored in SQLite)
- Proactive notifications: focus list after evening run, morning update, heat warnings on entry
- `stark sync` command diffs Angel One portfolio against `positions` table
- All scheduled actions logged to `automation_log` table
- systemd services auto-restart on crash and start on boot
- `PRAGMA busy_timeout = 5000` set for concurrent scheduler + bot DB access
- Graceful shutdown on UPS low battery (clean WAL checkpoint before halt)
- All existing 104+ tests continue to pass
- Telegram bot works on dev machine too (not Pi-specific)

### Must NOT Have
- No webhook server or public IP requirement (long-polling only)
- No new npm dependencies for Telegram (use `fetch()` to `api.telegram.org`)
- No changes to `@stark/core` public interfaces (only additive)
- No Docker or containerization (bare metal Bun on Pi)
- No OpenClaw, Nanobot, or any agent framework
- No breaking changes to existing CLI commands
- No auto-trading or order execution

---

## Cross-Cutting Seams for Multi-Platform + Agent Extensibility

**Philosophy:** Same as intraday seams — interfaces and columns now, zero features built. If the user later wants WhatsApp, Discord, Slack, or an agent framework, the refactoring cost should be hours, not weeks.

### Why Seams Now

The Telegram bot as written in Step 3 would work fine. But without seams, adding WhatsApp means: duplicating `bot.ts` with WhatsApp-specific long-polling, duplicating `formatter.ts` with WhatsApp markdown, duplicating session management, and forking `index.ts` into two entry points with shared state. Every new platform doubles the surface area.

With seams, adding WhatsApp means: implementing `WhatsAppPlatform` (one file), registering it, done.

### Seam Table

| # | Seam | Where | Effort | Future Consumer |
|---|------|-------|--------|-----------------|
| 1 | `MessagePlatform` interface | Step 3 — `packages/telegram/src/platform.ts` | 30 min | WhatsApp, Discord, Slack, Signal adapters |
| 2 | `platform` column on `telegram_sessions` | Step 1 — schema migration | 2 min | Per-platform conversation history |
| 3 | `NotificationChannel` interface | Step 5 — `packages/core/src/notifications/channel.ts` | 15 min | WhatsApp notifier, Discord webhook, email |
| 4 | `ToolRegistry` for executor commands | Step 3 — `packages/telegram/src/executor.ts` | 20 min | MCP tool exposure, agent framework integration |
| 5 | Platform-agnostic NLU input/output | Step 3 — `nlu.ts` takes plain strings, not Telegram objects | 5 min | Any platform, voice transcription |
| 6 | `notification_preferences` config section | Step 1 — config | 5 min | Per-platform notification routing |
| 7 | Executor returns structured data, formatter is per-platform | Step 3 — separation of data vs presentation | 15 min | Platform-specific rendering (Telegram markdown, Discord embeds, WhatsApp plain text) |

**Total seam effort: ~1.5 hours** (spread across Steps 1, 3, 5)

### Seam Details

#### Seam 1: `MessagePlatform` Interface

Create `packages/telegram/src/platform.ts`:

```typescript
/**
 * Abstraction over a messaging platform. Telegram is the first implementation.
 * Future: WhatsAppPlatform, DiscordPlatform, SlackPlatform.
 */
export interface MessagePlatform {
  readonly name: string;  // 'telegram' | 'whatsapp' | 'discord' | ...

  /** Start listening for incoming messages. Calls handler for each. */
  startListening(handler: MessageHandler): Promise<void>;

  /** Send a text message to a chat/channel. */
  sendMessage(chatId: string, text: string): Promise<void>;

  /** Send a typing/processing indicator. */
  sendTypingIndicator(chatId: string): Promise<void>;

  /** Stop listening and clean up. */
  dispose(): Promise<void>;
}

export interface IncomingMessage {
  chatId: string;
  text: string;
  platform: string;
  senderId: string;
  timestamp: number;
}

export type MessageHandler = (message: IncomingMessage) => Promise<string>;
```

`TelegramBot` in `bot.ts` implements `MessagePlatform`. The `index.ts` entry point instantiates the platform by name from config, not by importing `TelegramBot` directly:

```typescript
// index.ts — platform-agnostic entry point
const platform = createPlatform(config);  // returns TelegramPlatform for now
await platform.startListening(handler);
```

**What this enables later:** `createPlatform()` becomes a factory. Add a `whatsapp` case and a `WhatsAppPlatform` class — the NLU, executor, session, and notification layers work unchanged.

**What this does NOT do now:** No multi-platform simultaneous support. One platform per process. Multi-platform = run multiple instances (one `stark-telegram` service, one `stark-whatsapp` service). True multi-platform routing via a single process is agent-framework territory and explicitly deferred.

#### Seam 2: `platform` Column on Sessions

Rename `telegram_sessions` table to `chat_sessions` with a `platform` column:

```sql
CREATE TABLE IF NOT EXISTS chat_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  platform TEXT NOT NULL DEFAULT 'telegram',
  chat_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_chat_sessions_lookup
  ON chat_sessions(platform, chat_id, created_at);
```

Query methods take `platform` as first argument:
- `insertChatMessage(platform: string, chatId: string, role: string, content: string)`
- `getRecentChatMessages(platform: string, chatId: string, limit: number)`
- `trimChatHistory(platform: string, chatId: string, keep: number)`

**Cost:** 2 minutes (add one column, adjust one index, adjust 3 query signatures).

#### Seam 3: `NotificationChannel` Interface

Create `packages/core/src/notifications/channel.ts`:

```typescript
/**
 * Abstraction over a notification delivery mechanism.
 * TelegramNotifier is the first implementation.
 * Future: WhatsAppNotifier, DiscordWebhookNotifier, EmailNotifier.
 */
export interface NotificationChannel {
  readonly name: string;
  send(message: string): Promise<boolean>;  // returns false on failure (best-effort)
}
```

`TelegramNotifier` implements `NotificationChannel`. The scheduler uses `NotificationChannel`, not `TelegramNotifier` directly:

```typescript
// scheduler-start.ts
const channels: NotificationChannel[] = [];
if (config.telegram?.botToken && config.telegram?.allowedChatIds?.[0]) {
  channels.push(new TelegramNotifier(config.telegram.botToken, config.telegram.allowedChatIds[0]));
}
// Future: if (config.whatsapp?.apiKey) channels.push(new WhatsAppNotifier(...));

// In callbacks:
for (const channel of channels) {
  await channel.send(formattedMessage);
}
```

**What this enables later:** Add any notification channel by implementing the interface and adding to the array. Notifications fan out to all configured channels.

#### Seam 4: `ToolRegistry` for Executor Commands

Instead of a hardcoded `switch` in `executor.ts`, register commands in a map:

```typescript
interface StarkTool {
  name: string;
  description: string;
  parameters: Record<string, { type: string; required: boolean; description: string }>;
  execute: (args: Record<string, unknown>, context: CommandContext) => Promise<ToolResult>;
}

interface ToolResult {
  data: unknown;        // structured data (platform-agnostic)
  summary: string;      // human-readable one-liner
}

class ToolRegistry {
  private tools = new Map<string, StarkTool>();

  register(tool: StarkTool): void { this.tools.set(tool.name, tool); }
  get(name: string): StarkTool | undefined { return this.tools.get(name); }
  getAll(): StarkTool[] { return [...this.tools.values()]; }

  /** Generate tool descriptions for NLU system prompt */
  toNLUPrompt(): string {
    return this.getAll().map(t =>
      `- ${t.name} ${JSON.stringify(t.parameters)} — ${t.description}`
    ).join('\n');
  }

  /** Generate MCP-compatible tool list (future agent framework integration) */
  toMCPTools(): Array<{ name: string; description: string; inputSchema: object }> {
    return this.getAll().map(t => ({
      name: `stark_${t.name}`,
      description: t.description,
      inputSchema: {
        type: 'object',
        properties: t.parameters,
        required: Object.entries(t.parameters).filter(([_, v]) => v.required).map(([k]) => k),
      },
    }));
  }
}
```

Each command registers itself:

```typescript
registry.register({
  name: 'score',
  description: 'Score a stock using the 13-factor system',
  parameters: { symbol: { type: 'string', required: true, description: 'NSE stock symbol' } },
  execute: async (args, ctx) => {
    const result = await ctx.engine.scoreSymbol(args.symbol as string, ...);
    return { data: result, summary: `${args.symbol}: ${result.totalScore}/${result.maxPossibleScore}` };
  },
});
```

**What this enables later:**
- **NLU system prompt auto-generated** from registry (no manual prompt maintenance when adding commands)
- **MCP tool exposure** via `toMCPTools()` — if the user ever wants to expose Stark commands to Claude Desktop, Cursor, or an agent framework via MCP, the tool definitions are already there. One MCP server file that calls `registry.toMCPTools()` and wires `execute()`.
- **Agent framework integration** — OpenClaw skills, Nanobot tools, or any MCP-compatible agent can call Stark commands through the same interface without touching `@stark/core`.
- **New commands automatically available** everywhere — register once, available in CLI, Telegram, MCP, and any future platform.

**What this does NOT do now:** No MCP server. No skill packaging. No agent integration. Just a `Map<string, StarkTool>` that the executor iterates instead of a switch statement.

#### Seam 5: Platform-Agnostic NLU

Already implicit in the plan, but make it explicit: `StarkNLU.parse()` takes `(text: string, history: Array<{role, content}>)`. It never receives a Telegram `Update` object, a Discord `Message`, or a WhatsApp webhook payload. The platform adapter extracts plain text before calling NLU.

**Future:** Voice interface → speech-to-text produces a string → same NLU pipeline. No changes needed.

#### Seam 6: `notification_preferences` Config

```typescript
export interface NotificationPreferences {
  eveningSummary: boolean;     // default: true
  morningUpdate: boolean;      // default: true
  syncAlerts: boolean;         // default: true
  heatWarnings: boolean;       // default: true
  channels: string[];          // default: ['telegram'] — future: ['telegram', 'whatsapp', 'email']
}
```

Add to `StarkConfig`:
```typescript
notifications?: NotificationPreferences;
```

Scheduler reads `config.notifications.channels` to decide which `NotificationChannel` implementations to instantiate. For now only `'telegram'` is supported; unknown channel names are silently skipped.

#### Seam 7: Executor Returns Structured Data

Each `StarkTool.execute()` returns `{ data, summary }` not a formatted string. The formatter is called by the platform layer, not the executor:

```typescript
// In the bot message handler (platform-specific):
const parsed = await nlu.parse(text, history);
const tool = registry.get(parsed.command);
const result = await tool.execute(parsed.args, context);
const formatted = telegramFormatter.format(parsed.command, result.data);  // platform-specific
return formatted;
```

**What this enables later:** Discord can format the same `result.data` as an embed with fields. WhatsApp can format it as plain text with emojis. A web UI can render it as React components. The executor never knows or cares about the presentation layer.

---

## Task Flow

```
[Step 1: DB + Config additions]
  |
  v
[Step 2: stark sync command (portfolio auto-journal)]
  |
  v
[Step 3: packages/telegram — bot + NLU + executor]
  |
  v
[Step 4: Scheduler service (evening/morning/sync cron)]
  |
  v
[Step 5: Proactive notifications (bot ← scheduler integration)]
  |
  v
[Step 6: RPi deployment (OS, Bun, systemd, UPS)]
  |
  v
[Step 7: Testing + documentation]
```

---

## Detailed TODOs

### Step 1: DB Migration + Config Extension + busy_timeout

**Objective:** Add the database table and config fields needed by Steps 2-5.

**Files to modify:**
- `packages/core/src/db/schema.ts` — add migration v2 (if not already added by `stark-automation.md`) with `telegram_sessions` table and `automation_log` table
- `packages/core/src/db/adapter.ts` — add `PRAGMA busy_timeout = 5000` after WAL pragma (line 29)
- `packages/core/src/db/queries.ts` — add query methods for telegram sessions and automation log
- `packages/core/src/config/index.ts` — add `TelegramConfig` and `SchedulerConfig` to `StarkConfig`

**Work:**

1. Check if migration v2 from `stark-automation.md` already exists. If not, create it. Add these tables:

```sql
-- Automation log (may already exist from stark-automation plan)
CREATE TABLE IF NOT EXISTS automation_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  event_type TEXT NOT NULL,
  payload TEXT,
  status TEXT NOT NULL DEFAULT 'ok',
  error_message TEXT
);

-- Chat session history for multi-turn NLU (Seam 2: platform column for multi-platform)
CREATE TABLE IF NOT EXISTS chat_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  platform TEXT NOT NULL DEFAULT 'telegram',
  chat_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_chat_sessions_lookup
  ON chat_sessions(platform, chat_id, created_at);
```

2. Add `PRAGMA busy_timeout = 5000;` in `BunSQLiteAdapter` constructor after `PRAGMA journal_mode = WAL;`

3. Add config interfaces:

```typescript
export interface TelegramConfig {
  botToken?: string;
  allowedChatIds?: string[];  // whitelist — only respond to these chats
  maxHistoryPerChat: number;  // default: 10
}

export interface SchedulerConfig {
  eveningTime: string;   // default: "20:00" (8 PM IST)
  morningTime: string;   // default: "09:00" (9 AM IST)
  syncIntervalMin: number; // default: 30 (during market hours)
  enabled: boolean;       // default: true
}
```

4. Add to `StarkConfig`:
```typescript
telegram?: TelegramConfig;
scheduler?: SchedulerConfig;
notifications?: NotificationPreferences;  // Seam 6
```

5. Add `NotificationPreferences` interface (Seam 6):
```typescript
export interface NotificationPreferences {
  eveningSummary: boolean;     // default: true
  morningUpdate: boolean;      // default: true
  syncAlerts: boolean;         // default: true
  heatWarnings: boolean;       // default: true
  channels: string[];          // default: ['telegram'] — future: ['telegram', 'whatsapp', 'email']
}
```

6. Add `Queries` methods (Seam 2: platform-aware signatures):
- `insertChatMessage(platform: string, chatId: string, role: 'user' | 'assistant', content: string): void`
- `getRecentChatMessages(platform: string, chatId: string, limit: number): Array<{ role: string; content: string }>`
- `trimChatHistory(platform: string, chatId: string, keep: number): void` — delete oldest messages beyond `keep` count
- `insertAutomationLog(eventType: string, payload?: string, status?: string, errorMessage?: string): void`
- `getAutomationLogs(since: string, limit: number): AutomationLogRow[]`

**Acceptance Criteria:**
- [ ] Migration v2 creates `telegram_sessions` and `automation_log` tables without breaking v1 databases
- [ ] `PRAGMA busy_timeout` is set — concurrent DB access does not throw SQLITE_BUSY
- [ ] Config loads with new optional `telegram` and `scheduler` fields without breaking existing configs
- [ ] `getRecentTelegramMessages()` returns messages in chronological order
- [ ] `trimTelegramHistory()` keeps only the N most recent messages per chat
- [ ] All 104+ existing tests still pass

---

### Step 2: `stark sync` Command (Portfolio Auto-Journal)

**Objective:** Automatically detect new entries and exits by comparing Angel One portfolio positions against Stark's `positions` table.

**Files to create:**
- `packages/core/src/journal/portfolio-sync.ts` — sync logic
- `packages/core/tests/portfolio-sync.test.ts` — tests with MockProvider
- `packages/cli/src/commands/sync.ts` — CLI command

**Files to modify:**
- `packages/core/src/api/data-provider.ts` — add `fetchPositions()` to `DataProvider` interface
- `packages/core/src/api/angel-one.ts` — implement `fetchPositions()` via Angel One portfolio API
- `packages/core/src/api/mock-provider.ts` — stub `fetchPositions()`
- `packages/cli/bin/stark.ts` — register `sync` command

**Work:**

1. Add to `DataProvider` interface:
```typescript
fetchPositions(): Promise<BrokerPosition[]>;
```

```typescript
interface BrokerPosition {
  symbol: string;
  token: string;
  quantity: number;
  averagePrice: number;
  exchange: string;
}
```

2. Implement `AngelOneProvider.fetchPositions()`:
- Call `GET /rest/secure/angelbroking/order/v1/getPosition` or `/portfolio/v1/holdings` (verify endpoint from Angel One docs during implementation)
- Map response to `BrokerPosition[]`
- Filter to NSE equity only

3. Implement `PortfolioSync` class in `packages/core/src/journal/portfolio-sync.ts`:

```typescript
interface SyncResult {
  newEntries: Array<{ symbol: string; shares: number; avgPrice: number }>;
  newExits: Array<{ symbol: string; exitPrice: number }>;
  unchanged: number;
  errors: string[];
}

class PortfolioSync {
  constructor(private provider: DataProvider, private db: DatabaseAdapter) {}

  async sync(): Promise<SyncResult> {
    // 1. Fetch broker positions
    // 2. Get Stark open positions from DB
    // 3. Diff:
    //    - In broker but not in Stark → new entry (auto-log via TradeManager.entry())
    //    - In Stark but not in broker → closed (auto-log via TradeManager.exit())
    //    - In both → unchanged
    // 4. For new entries: auto-fill conviction as 'MEDIUM' (user can override later)
    // 5. For exits: use broker's sell price if available, else last close price. Default reason: 'DISCRETION'
    // 6. Log all actions to automation_log
    // 7. Return SyncResult
  }
}
```

4. Key edge cases:
- **Partial exits:** Broker shows 50 shares, Stark has 100. Flag as warning in SyncResult and log to automation_log. DO NOT auto-handle in v1. User can manually adjust via `stark exit`.
- **Positions entered outside Stark:** New positions found in broker that were never in Stark's watchlist. Auto-create entry with `conviction: 'MEDIUM'`, `score_at_entry: null`, `market_regime_at_entry: null`. Flag as "unscored entry" in automation_log.
- **Stop-loss inference:** For auto-created entries, set `stop_price` to null. User sets it via override.
- **Multiple syncs per day:** Use `positions.entry_date` + `positions.symbol` to avoid duplicate entries. If a position was already synced today, skip it.

5. CLI command `stark sync`:
- Uses `createCommandContext()` for auto-auth
- Calls `PortfolioSync.sync()`
- Prints summary: "2 new entries, 1 exit detected, 5 unchanged"
- Logs to automation_log

**Acceptance Criteria:**
- [ ] `fetchPositions()` returns current broker holdings
- [ ] New broker positions not in Stark are auto-logged as entries
- [ ] Closed positions (in Stark but not in broker) are auto-logged as exits
- [ ] Partial exits are flagged as warnings, not auto-processed
- [ ] Duplicate syncs on same day don't create duplicate entries
- [ ] `stark sync` prints a clear summary
- [ ] All sync actions logged to `automation_log` with event_type 'portfolio_sync'
- [ ] Works with MockProvider in tests (fixture data for broker positions)

---

### Step 3: `packages/telegram` — Bot + NLU + Executor

**Objective:** Build a Telegram bot that provides a natural language chat interface to all Stark commands, with multi-turn conversation support.

**Files to create:**
```
packages/telegram/
  package.json
  tsconfig.json
  src/
    platform.ts         — MessagePlatform interface (Seam 1)
    telegram-platform.ts — Telegram Bot API implementation of MessagePlatform
    nlu.ts              — Natural language → Stark command parsing via Gemini (Seam 5: platform-agnostic)
    tool-registry.ts    — StarkTool interface + ToolRegistry (Seam 4: MCP-ready)
    executor.ts         — Command execution bridge using ToolRegistry
    formatter.ts        — Base formatter interface + Telegram markdown formatter (Seam 7: structured data in, string out)
    session.ts          — Per-chat conversation history (platform-aware via Seam 2)
    index.ts            — Entry point: create platform, wire NLU + executor, start listening
  bin/
    stark-telegram.ts   — Entry script for systemd service
```

**Work:**

#### 3.1: `platform.ts` + `telegram-platform.ts` — Platform Abstraction (Seam 1)

Create `platform.ts` with the `MessagePlatform` interface (defined in Seam 1 above). Then implement `TelegramPlatform` using pure `fetch()` against the Telegram Bot API:

```typescript
class TelegramPlatform implements MessagePlatform {
  readonly name = 'telegram';
  constructor(private token: string, private allowedChatIds?: string[]) {}

  async startListening(handler: MessageHandler): Promise<void> {
    // Long-poll loop: GET /getUpdates with offset and timeout=30
    // For each update: extract text, construct IncomingMessage, check allowedChatIds
    // Call handler, send response via sendMessage
    // Handle network errors with exponential backoff (5s initial, 60s max)
    // This function never returns (infinite loop)
  }

  async sendMessage(chatId: string, text: string): Promise<void> {
    // POST /sendMessage with MarkdownV2 parse mode
    // Split messages >4096 chars into multiple sends
  }

  async sendTypingIndicator(chatId: string): Promise<void> {
    // POST /sendChatAction { action: 'typing' }
  }

  async dispose(): Promise<void> { /* cleanup */ }
}
```

Also add a platform factory:
```typescript
// platform-factory.ts
function createPlatform(config: StarkConfig): MessagePlatform {
  // For now, only Telegram. Future: switch on config to return WhatsAppPlatform, etc.
  if (!config.telegram?.botToken) throw new Error('No platform configured');
  return new TelegramPlatform(config.telegram.botToken, config.telegram.allowedChatIds);
}
```

#### 3.2: `nlu.ts` — Natural Language Understanding

Uses Gemini to parse user messages into structured Stark commands.

```typescript
interface ParsedCommand {
  command: string;        // 'score' | 'focus' | 'market' | 'heat' | ... | 'unknown'
  args: Record<string, unknown>;
  confidence: number;     // 0-1
  rawText: string;
}

class StarkNLU {
  constructor(private llmService: LLMService | null, private cache: LLMCache) {}

  async parse(userMessage: string, history: Array<{ role: string; content: string }>): Promise<ParsedCommand> {
    // 1. Try exact command matching first (regex patterns for common phrasing)
    // 2. If no exact match AND LLM is available: send to Gemini with system prompt + conversation history
    // 3. If LLM unavailable: return { command: 'unknown' }
  }
}
```

System prompt for Gemini NLU (stored as constant, not fetched):
```
You are a command parser for Stark, a stock trading CLI tool for Indian markets (NSE).
Given a user message and conversation history, extract the intended command and arguments.

Available commands:
- score { symbol: string } — Score a stock
- focus — Show today's focus list
- market — Show market regime and breadth
- heat — Show portfolio heat
- trades { filter?: 'open' | 'closed' | 'all' } — List trades
- entry { symbol: string, price: number, shares: number, stop: number, conviction?: 'HIGH' | 'MEDIUM' | 'LOW' } — Log entry
- exit { symbol: string, price: number, reason?: 'STOPPED' | 'TARGET' | 'DISCRETION' | 'INVALIDATED' } — Log exit
- evening — Run evening workflow
- morning — Run morning workflow
- sync — Sync portfolio from broker
- performance — Show performance stats
- evolve — Show factor edge analysis
- override { symbol: string, factor: string, score: number } — Override a factor score
- import { symbols: string[], priority?: number } — Import symbols to watchlist
- status — Show account and position status
- help — Show available commands
- history — What automated actions happened recently

Respond ONLY with a JSON object: { "command": "...", "args": { ... }, "confidence": 0.0-1.0 }
If the user message references a previous message (e.g., "override its linearity"), resolve "it/its/that" from conversation history.
If you cannot determine the command, respond with { "command": "unknown", "args": {}, "confidence": 0.0 }
```

Key implementation notes:
- Exact matching handles 80%+ of messages (regex patterns for common phrasing)
- LLM is only called when exact matching fails — keeps costs low
- Conversation history (last 10 messages) is included in the Gemini prompt for pronoun resolution
- Parse Gemini response as JSON. If parsing fails, return `unknown`.
- Do NOT cache NLU results — user messages are too unique to benefit from caching

#### 3.3: `tool-registry.ts` + `executor.ts` — ToolRegistry Pattern (Seam 4)

Create `tool-registry.ts` with `StarkTool` interface and `ToolRegistry` class (defined in Seam 4 above). The executor uses the registry instead of a hardcoded switch:

```typescript
class CommandExecutor {
  private registry: ToolRegistry;

  constructor(private context: CommandContext) {
    this.registry = new ToolRegistry();
    this.registerAllTools();
  }

  private registerAllTools(): void {
    this.registry.register({
      name: 'score',
      description: 'Score a stock using the 13-factor system',
      parameters: { symbol: { type: 'string', required: true, description: 'NSE stock symbol' } },
      execute: async (args, ctx) => {
        const result = await ctx.engine.scoreSymbol(args.symbol as string, ...);
        return { data: result, summary: `${args.symbol}: ${result.totalScore}/${result.maxPossibleScore}` };
      },
    });
    // ... register all 16+ tools
  }

  async execute(parsed: ParsedCommand): Promise<ToolResult> {
    const tool = this.registry.get(parsed.command);
    if (!tool) return { data: null, summary: "I didn't understand that. Type 'help' for available commands." };
    return tool.execute(parsed.args, this.context);
  }

  /** Expose registry for NLU prompt generation and future MCP server */
  getRegistry(): ToolRegistry { return this.registry; }
}
```

Key implementation notes:
- Each tool's `execute()` calls the SAME core functions that the CLI commands use (via `context.queries`, `context.engine`, `TradeManager`, `PortfolioSync`, etc.)
- `ToolResult.data` is structured (platform-agnostic). `ToolResult.summary` is a one-liner fallback.
- Long-running tools (`evening`, `score` batch) should call `platform.sendTypingIndicator()` periodically
- Errors are caught and returned as `{ data: null, summary: 'user-friendly error message' }`
- NLU system prompt is auto-generated: `registry.toNLUPrompt()` — no manual prompt maintenance when adding new tools
- `registry.toMCPTools()` is available but not called anywhere yet — Seam 4 for future MCP server

#### 3.4: `formatter.ts` — Structured Data → Platform-Specific Output (Seam 7)

Define a `ResultFormatter` interface and implement `TelegramFormatter`:

```typescript
interface ResultFormatter {
  format(command: string, data: unknown): string;
}

class TelegramFormatter implements ResultFormatter {
  format(command: string, data: unknown): string {
    switch (command) {
      case 'score': return this.formatScoreResult(data as ScoreResult);
      case 'focus': return this.formatFocusList(data as FocusListData);
      case 'heat': return this.formatPortfolioHeat(data as HeatResult);
      // ... etc
      default: return String(data);
    }
  }

  private formatScoreResult(result: ScoreResult): string { ... }
  private formatFocusList(data: FocusListData): string { ... }
  private formatPortfolioHeat(heat: HeatResult): string { ... }
  private formatTradeEntry(result: EntryResult): string { ... }
  private formatSyncResult(result: SyncResult): string { ... }
  private formatPerformance(report: PerformanceReport): string { ... }
}
```

The executor returns `ToolResult` (structured). The platform handler calls the formatter:

```typescript
// In the message handler (platform-specific wiring):
const result = await executor.execute(parsed);
const formatted = formatter.format(parsed.command, result.data) || result.summary;
return formatted;
```

Use Telegram MarkdownV2 formatting. Escape special characters: `_*[]()~>#+-=|{}.!`

**What this enables later:** `DiscordFormatter` renders as embeds. `WhatsAppFormatter` uses plain text with emojis. `WebFormatter` returns React-renderable data. The executor and tools never change.

#### 3.5: `session.ts` — Platform-Aware Conversation History (Seam 2)

```typescript
class ChatSessionManager {
  constructor(private queries: Queries, private platform: string, private maxHistory: number) {}

  addMessage(chatId: string, role: 'user' | 'assistant', content: string): void {
    this.queries.insertChatMessage(this.platform, chatId, role, content);
    this.queries.trimChatHistory(this.platform, chatId, this.maxHistory);
  }

  getHistory(chatId: string): Array<{ role: string; content: string }> {
    return this.queries.getRecentChatMessages(this.platform, chatId, this.maxHistory);
  }
}
```

#### 3.6: `index.ts` — Platform-Agnostic Entry Point

```typescript
async function main(): Promise<void> {
  const config = loadConfig();
  const context = await createCommandContext();

  // Platform (Seam 1)
  const platform = createPlatform(config);

  // NLU (Seam 5: receives plain strings, not platform objects)
  const executor = new CommandExecutor(context);
  const nlu = new StarkNLU(context.llmService, executor.getRegistry());

  // Formatter (Seam 7: per-platform)
  const formatter = new TelegramFormatter();  // Future: createFormatter(platform.name)

  // Session (Seam 2: platform-aware)
  const sessions = new ChatSessionManager(
    context.queries, platform.name, config.telegram?.maxHistoryPerChat ?? 10
  );

  console.log(`Stark ${platform.name} bot started. Listening for messages...`);

  await platform.startListening(async (message) => {
    sessions.addMessage(message.chatId, 'user', message.text);
    const history = sessions.getHistory(message.chatId);
    const parsed = await nlu.parse(message.text, history);
    const result = await executor.execute(parsed);
    const formatted = formatter.format(parsed.command, result.data) || result.summary;
    sessions.addMessage(message.chatId, 'assistant', formatted);
    return formatted;
  });
}
```

#### 3.7: `packages/telegram/package.json`

```json
{
  "name": "@stark/telegram",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "dependencies": {
    "@stark/core": "workspace:*"
  }
}
```

**Acceptance Criteria:**
- [ ] Bot connects to Telegram and receives messages via long-polling
- [ ] `allowedChatIds` whitelist works (ignores messages from unauthorized chats)
- [ ] Exact command matching handles "score RELIANCE", "show focus list", "my heat", "open trades"
- [ ] Gemini NLU correctly parses natural language like "how did TATAELXSI score?" → `{ command: 'score', args: { symbol: 'TATAELXSI' } }`
- [ ] Multi-turn context works: "score INFY" → result → "override its linearity to 1" → correctly targets INFY
- [ ] Conversation history is persisted in `telegram_sessions` table and trimmed to `maxHistoryPerChat`
- [ ] `evening` command via Telegram runs full scoring pipeline and returns formatted focus list
- [ ] `entry` and `exit` commands work via Telegram
- [ ] Long messages (>4096 chars) are split into multiple Telegram messages
- [ ] Network errors in long-polling reconnect with backoff
- [ ] Bot works on dev machine (not Pi-specific)

---

### Step 4: Scheduler Service

**Objective:** Run evening/morning workflows and portfolio sync on a schedule, independent of the Telegram bot.

**Files to create:**
- `packages/core/src/scheduler/scheduler.ts` — trading-day-aware scheduler (may already exist from `stark-automation.md`)
- `packages/core/src/scheduler/index.ts` — barrel export
- `packages/cli/src/commands/scheduler-start.ts` — long-running scheduler process entry point
- `packages/core/tests/scheduler.test.ts`

**Files to modify:**
- `packages/cli/bin/stark.ts` — register `scheduler` command

**Work:**

1. Implement `TradingScheduler` (if not already implemented from `stark-automation.md`):

```typescript
class TradingScheduler {
  constructor(
    private config: SchedulerConfig,
    private calendar: TradingCalendar,
  ) {}

  start(callbacks: {
    onEvening: () => Promise<void>;
    onMorning: () => Promise<void>;
    onSync: () => Promise<void>;
  }): void {
    // Use setInterval with 60-second tick
    // On each tick: check current IST time against scheduled times
    // If time matches AND isTradingDay() AND not already run today: fire callback
    // For sync: fire every syncIntervalMin during market hours (9:15-15:30 IST)
    // Track last run timestamps to prevent duplicate runs
  }

  stop(): void { /* clear intervals */ }
}
```

2. Implement `stark scheduler` command:

```typescript
async function schedulerStartCommand(): Promise<void> {
  const config = loadConfig();
  const context = await createCommandContext();
  const calendar = new TradingCalendar(config.nseHolidays);
  const scheduler = new TradingScheduler(config.scheduler ?? defaults, calendar);

  scheduler.start({
    onEvening: async () => {
      // Run same logic as eveningCommand()
      // Log result to automation_log
      // Notify via Telegram (see Step 5)
    },
    onMorning: async () => {
      // Run same logic as morningCommand()
      // Log to automation_log
      // Notify via Telegram
    },
    onSync: async () => {
      // Run PortfolioSync.sync()
      // Log to automation_log
      // Notify via Telegram only if new entries/exits detected
    },
  });

  console.log('Stark scheduler started. Ctrl+C to stop.');
  // Keep process alive
  await new Promise(() => {});
}
```

**Acceptance Criteria:**
- [ ] Scheduler fires evening callback at configured time on trading days only
- [ ] Scheduler fires morning callback at configured time on trading days only
- [ ] Sync fires every N minutes during market hours (9:15-15:30 IST) on trading days
- [ ] Weekends and NSE holidays are skipped
- [ ] Duplicate runs within same day are prevented
- [ ] All events logged to `automation_log`
- [ ] `stark scheduler` keeps running indefinitely (suitable for systemd)

---

### Step 5: Proactive Notifications (Scheduler → Telegram)

**Objective:** After scheduled workflows complete, push results to the user's Telegram chat.

**Files to create:**
- `packages/core/src/notifications/channel.ts` — `NotificationChannel` interface (Seam 3)
- `packages/core/src/notifications/telegram-notifier.ts` — Telegram implementation of `NotificationChannel`
- `packages/core/src/notifications/index.ts` — barrel export

**Files to modify:**
- `packages/cli/src/commands/scheduler-start.ts` — wire notifier into scheduler callbacks

**Work:**

1. Create `NotificationChannel` interface (Seam 3, defined in seams section above).

2. Implement `TelegramNotifier implements NotificationChannel`:

```typescript
class TelegramNotifier implements NotificationChannel {
  readonly name = 'telegram';
  constructor(private botToken: string, private chatId: string) {}

  async send(text: string): Promise<boolean> {
    // POST to api.telegram.org/bot<token>/sendMessage
    // parseMode: 'MarkdownV2'
    // Escape special chars
    // Retry once on failure
    // Log errors but don't throw (notifications are best-effort)
    // Return false on failure
  }
}
```

3. Wire into scheduler using channel array pattern (Seam 3):
```typescript
// Build notification channels from config
const channels: NotificationChannel[] = [];
if (config.telegram?.botToken && config.telegram?.allowedChatIds?.[0]) {
  channels.push(new TelegramNotifier(config.telegram.botToken, config.telegram.allowedChatIds[0]));
}
// Future: if (config.whatsapp?.enabled) channels.push(new WhatsAppNotifier(...));
// Future: if (config.discord?.webhookUrl) channels.push(new DiscordNotifier(...));

async function notify(text: string): Promise<void> {
  for (const channel of channels) {
    await channel.send(text);  // best-effort, won't throw
  }
}
```

2. Wire into scheduler callbacks:
- After evening: send focus list summary ("Evening scan complete — 4 stocks scored 8+. Top: BHARTIARTL (10.5), TCS (9.0). Regime: BULL. Reply 'focus' for details.")
- After morning: send update if anything changed ("Morning check — 1 stock gapped below stop. WIPRO invalidated.")
- After sync: send only if new entries/exits detected ("Sync detected: Bought 100 INFY @ ₹1,720. Auto-logged. Reply 'trades open' to review.")
- Portfolio heat warning: if heat exceeds warning threshold after any entry, send alert

3. The notifier chat ID comes from `config.telegram.allowedChatIds[0]` (primary chat). If not configured, notifications are silently skipped.

**Acceptance Criteria:**
- [ ] Evening workflow pushes focus list summary to Telegram
- [ ] Morning workflow pushes update only when changes detected
- [ ] Sync pushes notification only when new entries/exits detected
- [ ] Heat warning pushed when exceeding threshold
- [ ] If Telegram is unreachable, notification fails silently (logged, not thrown)
- [ ] If no `allowedChatIds` configured, notifications are skipped

---

### Step 6: Raspberry Pi Deployment

**Objective:** Set up the Pi as an always-on Stark server with systemd services and UPS-backed shutdown.

**This step is a manual setup guide, not code.** Create `docs/RPI_DEPLOYMENT.md`.

**Contents:**

#### 6.1: Hardware Setup
- Flash Raspberry Pi OS Lite (64-bit) onto USB SSD (not SD card)
- Configure USB boot in Pi firmware (if not already enabled)
- Attach Waveshare UPS HAT (B) with 2x 18650 cells
- Connect to home WiFi, set static IP (or use hostname `stark.local`)
- Enable SSH: `sudo systemctl enable ssh`

#### 6.2: Software Setup
```bash
# Install Bun
curl -fsSL https://bun.sh/install | bash
source ~/.bashrc

# Clone and install
git clone https://github.com/cluelessog/StarkTrading.git ~/stark
cd ~/stark
bun install

# Copy config from dev machine
scp ~/.stark/config.json pi@stark.local:~/.stark/config.json

# Add Telegram + scheduler config to config.json
# Test
bun run packages/cli/bin/stark.ts --help
bun run packages/cli/bin/stark.ts evening
```

#### 6.3: Telegram Bot Setup
- Message @BotFather on Telegram, create new bot, save token
- Message the bot once to initiate chat
- Get your chat ID: `curl https://api.telegram.org/bot<TOKEN>/getUpdates` → look for `chat.id`
- Add `botToken` and `allowedChatIds` to `~/.stark/config.json`

#### 6.4: systemd Services

Create `/etc/systemd/system/stark-telegram.service`:
```ini
[Unit]
Description=Stark Trading Telegram Bot
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/stark
ExecStart=/home/pi/.bun/bin/bun run packages/telegram/bin/stark-telegram.ts
Restart=always
RestartSec=10
Environment=HOME=/home/pi

[Install]
WantedBy=multi-user.target
```

Create `/etc/systemd/system/stark-scheduler.service`:
```ini
[Unit]
Description=Stark Trading Scheduler
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/stark
ExecStart=/home/pi/.bun/bin/bun run packages/cli/bin/stark.ts scheduler
Restart=always
RestartSec=10
Environment=HOME=/home/pi

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl daemon-reload
sudo systemctl enable stark-telegram stark-scheduler
sudo systemctl start stark-telegram stark-scheduler
journalctl -u stark-telegram -f
journalctl -u stark-scheduler -f
```

#### 6.5: UPS Graceful Shutdown

Create `scripts/ups-monitor.sh`:
```bash
#!/bin/bash
# Reads UPS HAT battery voltage via I2C
# Triggers shutdown when battery drops below threshold
# Run as root via cron: * * * * * /home/pi/stark/scripts/ups-monitor.sh

THRESHOLD_VOLTAGE=3.2  # per-cell voltage below which to shutdown

VOLTAGE=$(python3 -c "
import struct, smbus
bus = smbus.SMBus(1)
raw = bus.read_word_data(0x45, 0x02)
voltage = ((raw >> 8) | ((raw & 0xFF) << 8)) * 1.25 / 1000
print(f'{voltage:.2f}')
" 2>/dev/null || echo "0")

if (( $(echo "$VOLTAGE < $THRESHOLD_VOLTAGE" | bc -l) )); then
  logger "UPS voltage $VOLTAGE below threshold $THRESHOLD_VOLTAGE - initiating shutdown"
  systemctl stop stark-telegram stark-scheduler
  sleep 2
  shutdown -h now
fi
```

Add to root crontab: `* * * * * /home/pi/stark/scripts/ups-monitor.sh`

#### 6.6: Updating Stark on Pi
```bash
cd ~/stark && git pull && bun install && sudo systemctl restart stark-telegram stark-scheduler
```

**Acceptance Criteria:**
- [ ] Pi boots and both services start automatically
- [ ] Telegram bot responds to messages after boot
- [ ] Scheduler fires evening workflow at configured time on trading days
- [ ] `journalctl -u stark-telegram` shows bot activity
- [ ] UPS monitor triggers clean shutdown on low battery
- [ ] `git pull && bun install && systemctl restart` updates cleanly

---

### Step 7: Testing + Documentation

**Files to create:**
- `packages/telegram/tests/nlu.test.ts` — NLU parsing tests with mocked Gemini
- `packages/telegram/tests/executor.test.ts` — command execution tests with MockProvider
- `packages/telegram/tests/bot.test.ts` — bot message handling tests
- `docs/RPI_DEPLOYMENT.md` — setup guide from Step 6
- `docs/TELEGRAM_SETUP.md` — BotFather setup, getting chat ID, config

**Test scenarios for NLU:**

```typescript
// Exact matching
'score RELIANCE' → { command: 'score', args: { symbol: 'RELIANCE' } }
'focus list' → { command: 'focus', args: {} }
'my heat' → { command: 'heat', args: {} }
'open trades' → { command: 'trades', args: { filter: 'open' } }

// Natural language (requires Gemini mock)
'how is the market looking?' → { command: 'market' }
'enter BHARTIARTL at 1540, 100 shares, stop 1480' → { command: 'entry', args: { symbol: 'BHARTIARTL', price: 1540, shares: 100, stop: 1480 } }
'what scored highest tonight?' → { command: 'focus' }

// Multi-turn (requires history)
[history: scored INFY] 'override its linearity to 1' → { command: 'override', args: { symbol: 'INFY', factor: 'linearity', score: 1 } }
[history: showing focus list] 'tell me more about the second one' → { command: 'score', args: { symbol: '<second stock from focus list>' } }
```

**Acceptance Criteria:**
- [ ] All NLU test cases pass (exact matching + mocked Gemini for natural language)
- [ ] Executor tests verify correct `@stark/core` function calls
- [ ] RPi deployment doc is complete and accurate
- [ ] Telegram setup doc covers BotFather, chat ID, config

---

## Appendix A: New Config Fields (Complete)

```json
{
  "angelOne": { "apiKey": "...", "clientId": "...", "totpSecret": "..." },
  "llm": { "geminiKey": "...", "perplexityKey": "...", "enabled": true, "cacheResponses": true, "cacheTtlHours": 24 },
  "telegram": {
    "botToken": "123456:ABC-DEF...",
    "allowedChatIds": ["987654321"],
    "maxHistoryPerChat": 10
  },
  "scheduler": {
    "eveningTime": "20:00",
    "morningTime": "09:00",
    "syncIntervalMin": 30,
    "enabled": true
  },
  "emThresholds": { "strongBull": 25, "bull": 15, "cautious": 12, "choppy": 9.5 },
  "risk": { "swing": { "riskPerTrade": 10000, "totalCapital": 500000, "heatWarning": 0.06, "heatAlert": 0.08 } },
  "scoring": { "scoreThresholds": { "bull": 8.0, "cautious": 8.5, "choppy": 9.0, "bear": 10.0 }, "maxFocusStocks": { "strongBull": 5, "bull": 5, "cautious": 3, "choppy": 2, "bear": 0 } },
  "sheetId": "1SkXCX1Ax3n_EUsa06rzqWSdoCrlbGDENuFUOrMFyErw",
  "nseHolidays": []
}
```

## Appendix B: New Database Tables (Migration v2)

```sql
CREATE TABLE IF NOT EXISTS automation_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  event_type TEXT NOT NULL,
  payload TEXT,
  status TEXT NOT NULL DEFAULT 'ok',
  error_message TEXT
);

-- Seam 2: platform column for multi-platform extensibility
CREATE TABLE IF NOT EXISTS chat_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  platform TEXT NOT NULL DEFAULT 'telegram',
  chat_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_chat_sessions_lookup
  ON chat_sessions(platform, chat_id, created_at);
```

## Appendix C: File Summary

| Action | Path | Lines (est) | Seam |
|--------|------|-------------|------|
| CREATE | `packages/telegram/package.json` | 10 | |
| CREATE | `packages/telegram/tsconfig.json` | 10 | |
| CREATE | `packages/telegram/src/platform.ts` | 30 | Seam 1 |
| CREATE | `packages/telegram/src/telegram-platform.ts` | 120 | Seam 1 |
| CREATE | `packages/telegram/src/platform-factory.ts` | 15 | Seam 1 |
| CREATE | `packages/telegram/src/nlu.ts` | 180 | Seam 5 |
| CREATE | `packages/telegram/src/tool-registry.ts` | 60 | Seam 4 |
| CREATE | `packages/telegram/src/executor.ts` | 250 | Seam 4 |
| CREATE | `packages/telegram/src/formatter.ts` | 160 | Seam 7 |
| CREATE | `packages/telegram/src/session.ts` | 40 | Seam 2 |
| CREATE | `packages/telegram/src/index.ts` | 50 | |
| CREATE | `packages/telegram/bin/stark-telegram.ts` | 10 | |
| CREATE | `packages/telegram/tests/nlu.test.ts` | 100 | |
| CREATE | `packages/telegram/tests/executor.test.ts` | 80 | |
| CREATE | `packages/core/src/journal/portfolio-sync.ts` | 120 | |
| CREATE | `packages/core/src/notifications/channel.ts` | 15 | Seam 3 |
| CREATE | `packages/core/src/notifications/telegram-notifier.ts` | 50 | Seam 3 |
| CREATE | `packages/core/src/notifications/index.ts` | 5 | |
| CREATE | `packages/core/src/scheduler/scheduler.ts` | 100 | |
| CREATE | `packages/core/src/scheduler/index.ts` | 5 | |
| CREATE | `packages/cli/src/commands/sync.ts` | 40 | |
| CREATE | `packages/cli/src/commands/scheduler-start.ts` | 60 | |
| CREATE | `packages/core/tests/portfolio-sync.test.ts` | 80 | |
| CREATE | `packages/core/tests/scheduler.test.ts` | 60 | |
| CREATE | `scripts/ups-monitor.sh` | 25 | |
| CREATE | `docs/RPI_DEPLOYMENT.md` | 200 | |
| CREATE | `docs/TELEGRAM_SETUP.md` | 80 | |
| MODIFY | `packages/core/src/db/schema.ts` | +30 | Seam 2 |
| MODIFY | `packages/core/src/db/adapter.ts` | +1 | |
| MODIFY | `packages/core/src/db/queries.ts` | +60 | Seam 2 |
| MODIFY | `packages/core/src/config/index.ts` | +30 | Seam 6 |
| MODIFY | `packages/core/src/api/data-provider.ts` | +10 | |
| MODIFY | `packages/core/src/api/angel-one.ts` | +40 | |
| MODIFY | `packages/core/src/api/mock-provider.ts` | +10 | |
| MODIFY | `packages/cli/bin/stark.ts` | +10 | |
| MODIFY | `package.json` (root) | +1 | |
| **TOTAL** | | **~2,100** | **7 seams** |

## Appendix D: Relationship to Existing Plans

| Existing Plan | Relationship | Notes |
|---------------|-------------|-------|
| `stark-automation.md` | **Partially superseded** | This plan replaces the `stark daemon` approach with systemd services. The file watcher is dropped (import via Telegram instead). The scheduler, automation_log, and TOTP auto-auth concepts are reused. Config extensions may overlap — check during Step 1. |
| `stark-intelligent-automation.md` | **Fully compatible** | LLM factors, SessionManager, CommandContext are all used unchanged. The Telegram NLU layer adds a new consumer of `GeminiClient`. |
| `stark-mbi-integration.md` | **Fully compatible** | MBI regime used by scheduler for focus list generation. No changes needed. |
| `stark-intraday-extensibility.md` | **Fully compatible** | Seams are untouched. Future intraday sync can extend `PortfolioSync`. |
| `stark-openalgo-feasibility.md` | **Deferred** | OpenAlgo is not needed for this plan. `DataProvider` interface remains the seam for future broker abstraction. |

## Definition of Done

1. `bun run packages/telegram/bin/stark-telegram.ts` connects to Telegram and responds to messages
2. "Score RELIANCE" via Telegram returns a formatted factor breakdown within 30 seconds
3. "Show focus list" after evening run returns tonight's scored stocks
4. "Override its linearity to 1" after scoring a stock correctly targets that stock (multi-turn)
5. `stark scheduler` runs evening workflow at 20:00 IST on trading days and pushes focus list to Telegram
6. `stark sync` detects new broker positions and auto-logs entries
7. Both services run on Raspberry Pi 4 via systemd, survive reboot, and auto-restart on crash
8. UPS monitor triggers clean shutdown before batteries die
9. All existing 104+ tests pass unchanged
10. New code has test coverage for NLU parsing, command execution, portfolio sync, and scheduler logic
11. All 7 extensibility seams verified:
    - Seam 1: `MessagePlatform` interface exists, `TelegramPlatform` implements it, `index.ts` uses factory
    - Seam 2: `chat_sessions` table has `platform` column, all queries accept `platform` parameter
    - Seam 3: `NotificationChannel` interface exists, scheduler uses channel array (not TelegramNotifier directly)
    - Seam 4: `ToolRegistry` exists with `toMCPTools()` method, executor uses registry (not switch statement)
    - Seam 5: `NLU.parse()` takes `(string, history[])` — no platform-specific types in signature
    - Seam 6: `NotificationPreferences` in config with `channels: string[]`
    - Seam 7: Executor returns `ToolResult { data, summary }`, formatter is called by platform handler (not executor)

---

## Appendix E: Future Extensibility Paths (Enabled by Seams, NOT Built Now)

These are concrete features that become trivial to add because of the seams. Each lists the seams it depends on and estimated effort.

### Path 1: WhatsApp Interface
**Seams used:** 1, 2, 5, 6, 7
**Effort:** ~200 lines (one new file: `whatsapp-platform.ts`)
**How:** Implement `MessagePlatform` using WhatsApp Business API or Baileys library. Register in `platform-factory.ts`. Add `whatsapp` config section. Run as `stark-whatsapp` systemd service alongside `stark-telegram`. Sessions and NLU work unchanged — `platform` column separates conversation histories.

### Path 2: Discord Server Bot
**Seams used:** 1, 2, 3, 5, 6, 7
**Effort:** ~250 lines (platform + discord formatter for embeds)
**How:** Implement `MessagePlatform` using Discord.js or raw API. `DiscordFormatter` renders `ToolResult.data` as Discord embeds with fields instead of markdown. Add `DiscordNotifier implements NotificationChannel` for webhook-based push notifications.

### Path 3: MCP Server (Expose Stark to Claude Desktop / Cursor / Agent Frameworks)
**Seams used:** 4
**Effort:** ~150 lines (one new file: `packages/mcp/server.ts`)
**How:** Create a thin MCP server that calls `registry.toMCPTools()` to list available tools, and routes MCP `tool_call` requests to `registry.get(name).execute()`. Stark becomes a tool server that any MCP-compatible client can use: Claude Desktop, Cursor, OpenClaw, Nanobot, or any custom agent. No changes to `@stark/core` or the Telegram bot.

### Path 4: OpenClaw / Nanobot Integration (If Ever Needed)
**Seams used:** 4, 3
**How:** Instead of building a custom MCP server (Path 3), install OpenClaw/Nanobot and point it at the MCP server. The agent framework handles multi-agent coordination, platform routing, and persistent sessions. Stark's `ToolRegistry` exposes all commands as MCP tools. The agent calls them like any other MCP tool. Stark remains a clean tool provider — the orchestration layer is entirely external.

### Path 5: Voice Interface (Telegram Voice / Phone Call)
**Seams used:** 5, 1, 7
**Effort:** ~100 lines (speech-to-text adapter)
**How:** Telegram sends voice messages as `.ogg` files. Download, transcribe via Whisper API or Google STT, pass resulting text to `NLU.parse()` (Seam 5 — it takes plain strings). Response goes back as text (or optionally TTS). The NLU, executor, and tools are completely unaware that the input came from voice.

### Path 6: Web Dashboard (Tauri / Next.js)
**Seams used:** 4, 7
**How:** Phase 4 UI (already in the roadmap) can import `ToolRegistry` from `packages/telegram` and call the same `execute()` functions. `WebFormatter` renders `ToolResult.data` as React components. The web dashboard and Telegram bot share identical business logic — different formatters, same tools.

### What NOT to Build Speculatively

- **Multi-platform message routing in a single process** — If you need Stark on 3+ platforms simultaneously with shared conversation context across platforms ("I asked on Telegram, continue on WhatsApp"), that's when an agent framework genuinely helps. But that's a problem you don't have yet. Run separate services per platform until this becomes a real need.
- **Agent-to-agent communication** — If you ever have multiple AI agents (trading agent, research agent, risk agent) that need to coordinate, OpenClaw/SuperAGI makes sense. Stark is one agent. Don't split it into multiple agents to justify a multi-agent framework.
- **Custom skill marketplace** — OpenClaw's ClawHub model (community skills) is irrelevant for a personal trading tool. Your `ToolRegistry` IS your skill system — you add tools by writing TypeScript, not by downloading community packages with supply-chain attack risk.
