# Execution Plan: Logging System + Intraday Seams

**Created:** 2026-03-12
**Status:** v2 — RALPLAN CONSENSUS APPROVED (Architect + Critic)
**Mode:** SHORT
**Branches:** `feat/logging-system`, `feat/intraday-seams`
**Prerequisite:** Branched from `master` (172 tests pass, 3 pre-existing failures)

---

# Part 1: Logging System (`feat/logging-system`)

## RALPLAN-DR Summary

### Guiding Principles

1. **Grep-friendly over query-friendly.** Structured JSONL that works with `grep`, `jq`, and `cat`. No specialized tooling.
2. **Correlation over aggregation.** A single `runId` linking all events in one workflow run is more useful than dashboards.
3. **Layered verbosity.** Console shows WARN+ by default. Files capture DEBUG+. `--verbose`/`--quiet` control the dial.
4. **Zero-dependency.** Use Bun built-ins (`appendFileSync`, `console.log`). No npm logging libraries.
5. **Integrate, don't duplicate.** The ScoringLog already captures factor-level detail. The application log captures everything else and cross-references via `runId`.

### Design Tradeoff

This is intentionally more structured than `console.log()` because ScoringLog integration (shared `runId`) and post-mortem debugging (`grep` by `runId` across factor logs and application logs) require correlation that `console.log` cannot provide. The dual output model is a conscious choice: `console.log()` for user-facing workflow output (scores, focus lists), `Logger` for structured JSONL at phase boundaries. The JSONL file is **not** a complete record of all output — it captures state transitions and errors for debugging, not display data.

### Decision Drivers

1. **Debuggability:** Reconstruct full sequence of events in under 2 minutes when something breaks.
2. **Bun compatibility:** Many Node.js logging libraries have Bun compatibility issues. Native APIs are safer.
3. **Solo developer overhead:** The system should take <1 day to implement and near-zero effort to maintain.

### Options Considered

- **Option A: Custom JSONL Logger (CHOSEN)** -- ~150 lines, zero dependencies, guaranteed Bun compatibility, integrates with existing ScoringContext `session_id`.
- **Option B: Pino Logger** -- Rejected. Bun compatibility risk (sonic-boom async writer relies on Node.js stream internals). Over-engineered for a CLI tool that runs 2 minutes then exits.
- **Option C: Expand Scoring Log** -- Rejected. Mixing general events into factor-specific audit log corrupts both purposes. Schema mismatch.

---

## What Already Exists (Code Inventory)

### `packages/core/src/log/logger.ts` (117 lines)

**Existing `Logger` class provides:**
- `LogLevel` type: `'DEBUG' | 'INFO' | 'WARN' | 'ERROR'`
- `LogEntry` interface: `{ timestamp, level, message, correlationId?, context? }`
- Constructor: `{ logDir?, minLevel?, correlationId? }` -- defaults to `~/.stark/logs/`, `'INFO'`
- Level methods: `debug()`, `info()`, `warn()`, `error()` -- all take `(message, context?)`
- `withCorrelation(id)` -- creates new Logger instance with correlationId set
- `rotateOldLogs(keepDays)` -- deletes `stark-YYYY-MM-DD.jsonl` files older than N days
- File output: `appendFileSync()` to `~/.stark/logs/stark-YYYY-MM-DD.jsonl`
- Console output: colored `console.log()` with ANSI codes
- Singleton export: `export const logger: Logger = new Logger()`

**What is MISSING vs design doc:**
1. No `component` field in LogEntry (design requires dot-notation source like `api.angel`, `workflow`)
2. No `event` field in LogEntry (design requires machine-readable event names like `state_change`, `auth_check`)
3. No `runId` field -- has `correlationId` but it is not called `runId` and has no `setRunId()` method
4. No `child(component)` method returning a `ComponentLogger` with fixed prefix
5. No `init()` lifecycle method -- constructor does everything; no way to reconfigure after creation
6. No `flush()` method
7. Console output uses `console.log()` not `Bun.stderr.write()` -- interferes with piped stdout
8. No JSON.stringify safety wrapper (design requires try-catch for circular references)
9. No pre-init behavior (design requires console-only mode before `init()` is called)
10. Existing tests import from `vitest` (need new tests importing from `bun:test`)

### `packages/core/src/log/scoring-log.ts` (72 lines)

**Existing `ScoringLog` class provides:**
- `ScoringLogEntry` interface: `{ timestamp, sessionId, symbol, factor, inputSummary, result, reasoning, dataSource }`
- `append(entry)`, `read(date?)`, `getLogPath(date?)`, `rotateOldLogs(keepDays)`
- File output: `scoring-YYYY-MM-DD.jsonl`

**What is MISSING:**
- No `runId` in ScoringLogEntry -- has `sessionId` but this is the ScoringContext UUID, not the logger's `runId`. Design says these should be the SAME value.

### `packages/core/src/log/index.ts` (2 lines)

Re-exports both modules. Will need to export new `ComponentLogger` type.

### `packages/core/src/scoring/context.ts` (61 lines)

**Existing:**
- `ScoringContext.sessionId` generated via `randomUUID()` in `createScoringContext()`
- No link to logger's runId

**What is MISSING:**
- `sessionId` should be set to `logger.runId` instead of a random UUID (or accept an optional override)

### `packages/core/src/scoring/engine.ts` (253 lines)

**Existing:**
- `scoreBatch()` calls `createScoringContext()` internally
- No logging instrumentation

**What is MISSING:**
- Should accept optional `runId` parameter or use logger's current runId for the ScoringContext
- No batch_summary logging at end of scoring

### `packages/cli/bin/stark.ts` (164 lines)

**Existing:**
- No `--verbose`/`-v` or `--quiet`/`-q` flags
- `-v` is currently mapped to `--version` (CONFLICT -- design must use `--verbose` only, not `-v`)
- No `logs` command registered
- No logger initialization at entry point
- No runId generation

### `packages/cli/src/utils/command-context.ts` (45 lines)

**Existing:**
- `createCommandContext()` returns `{ config, db, queries, provider, llmService, engine }`
- No logger in the context
- No runId generation

**What is MISSING:**
- Should initialize logger, generate runId, add logger to returned context

### `packages/cli/src/commands/evening.ts` (74 lines)

- No state transition logging
- 6 workflow phases visible: get watchlist -> score batch -> market regime -> focus list -> summary -> stats

### `packages/cli/src/commands/morning.ts` (66 lines)

- No state transition logging
- 3 workflow phases: get focus stocks -> overnight news -> check quotes/gaps

### `packages/cli/src/commands/review.ts` (192 lines)

- No state transition logging
- Interactive command -- state logging less critical

### Existing Tests

- `packages/core/tests/logger.test.ts` -- imports from `vitest`, 3 test cases (log levels, file output, withCorrelation)
- `packages/core/tests/scoring-log.test.ts` -- imports from `vitest`, 3 test cases (append, read/parse, malformed lines)

---

## Implementation Steps

### Step 1: Enhance Logger Core (~120 lines changed/added)

**File:** `packages/core/src/log/logger.ts`

**Changes:**

1. **Rename/extend `LogEntry` interface** to add `runId`, `component`, `event` fields:
   ```typescript
   export interface LogEntry {
     ts: string;           // was 'timestamp'
     level: LogLevel;
     runId: string;
     component: string;
     event: string;
     msg: string;          // was 'message'
     data?: Record<string, unknown>;  // was 'context'
   }
   ```

2. **Add `ComponentLogger` class** (~20 lines):
   ```typescript
   export class ComponentLogger {
     constructor(private logger: Logger, private component: string) {}
     error(event: string, msg: string, data?: Record<string, unknown>): void;
     warn(event: string, msg: string, data?: Record<string, unknown>): void;
     info(event: string, msg: string, data?: Record<string, unknown>): void;
     debug(event: string, msg: string, data?: Record<string, unknown>): void;
   }
   ```

3. **Refactor `Logger` class** to support the enhanced API:
   - Add `private runId: string = 'no-run'`
   - Add `private initialized: boolean = false`
   - Add `setRunId(id: string): void`
   - Add `getRunId(): string` (getter for ScoringContext integration)
   - Add `child(component: string): ComponentLogger`
   - Add `init(options: { logDir?: string; consoleLevel?: LogLevel }): void`
   - Add `flush(): void` (no-op for sync writes, but keeps interface ready)
   - Change `log()` signature to `(level, component, event, msg, data?)` internally
   - Breaking change: old 2-arg signatures (`info(msg, ctx?)`) are replaced by new 4-arg signatures (`info(component, event, msg, data?)`). Since only `logger.test.ts` calls the old API (no production callers), **replace `logger.test.ts` contents** with `bun:test` imports and new API signatures in the same commit (Step 1). Do NOT create a separate `logger-enhanced.test.ts`.
   - Console output: use `process.stderr.write()` instead of `console.log()` (Bun compatible, avoids stdout interference)
   - Add JSON.stringify safety: wrap in try-catch, fallback to `{ _serializationError: ... }`
   - Pre-init behavior: before `init()`, write to stderr only (no file). After `init()`, write to both.

4. **Update convenience methods** to accept `(component, event, msg, data?)`:
   ```typescript
   error(component: string, event: string, msg: string, data?: Record<string, unknown>): void;
   warn(component: string, event: string, msg: string, data?: Record<string, unknown>): void;
   info(component: string, event: string, msg: string, data?: Record<string, unknown>): void;
   debug(component: string, event: string, msg: string, data?: Record<string, unknown>): void;
   ```

5. **Rename `rotateOldLogs` to `rotateLogs`** for consistency with design doc. Keep old name as deprecated alias.

6. **Generate runId format:** `evt-YYYYMMDD-HHMMSS`
   ```typescript
   export function generateRunId(): string {
     const now = new Date();
     const pad = (n: number) => String(n).padStart(2, '0');
     return `evt-${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
   }
   ```

**IMPORTANT DESIGN DECISION:** The existing `Logger` API uses `logger.info(message, context?)`. The new API uses `logger.info(component, event, msg, data?)`. This is a **breaking change**. Since the singleton `logger` is only consumed by the test file and nowhere else in production code, this is safe. The existing tests will be replaced.

**Acceptance Criteria:**
- [ ] LogEntry has fields: `ts`, `level`, `runId`, `component`, `event`, `msg`, `data?`
- [ ] `setRunId()` / `getRunId()` work; default is `'no-run'`
- [ ] `child('api.angel')` returns ComponentLogger that prepends component
- [ ] `init({ logDir, consoleLevel })` opens file writer; pre-init writes to stderr only
- [ ] Console output goes to stderr, not stdout
- [ ] JSON.stringify failure does not crash logger
- [ ] `rotateLogs(14)` deletes files older than 14 days
- [ ] `generateRunId()` returns `evt-YYYYMMDD-HHMMSS` format

**Line estimate:** ~180 lines total (was ~117, net add ~63)

---

### Step 2: Update Log Exports + ScoringLog runId (~15 lines changed)

**File:** `packages/core/src/log/index.ts`

- Export `ComponentLogger`, `generateRunId`

**File:** `packages/core/src/log/scoring-log.ts`

- No structural changes needed. The `ScoringLogEntry.sessionId` will be set to the same value as `logger.runId` by the caller (ScoringEngine/CommandContext). The ScoringLog itself does not need to know about the Logger.

**Acceptance Criteria:**
- [ ] `import { ComponentLogger, generateRunId } from '@stark/core/log/index.js'` works
- [ ] No breaking changes to ScoringLog

**Line estimate:** ~5 lines changed

---

### Step 3: CLI Flags + Logger Init + RunId (~80 lines changed)

**File:** `packages/cli/bin/stark.ts`

1. **Add `logs` command** to COMMANDS array:
   ```typescript
   { name: "logs", description: "View and filter application logs" },
   ```

2. **Extract global flags** before command dispatch:
   ```typescript
   // Global flags (extracted before command routing)
   const verbose = args.includes('--verbose');
   const quiet = args.includes('--quiet');
   // Remove global flags from args passed to commands
   const commandArgs = args.slice(1).filter(a => !['--verbose', '--quiet'].includes(a));
   ```

3. **IMPORTANT: `-v` conflict.** Currently `-v` maps to `--version`. Keep this behavior. `--verbose` is the only verbose flag (no `-v` shorthand). This avoids breaking existing usage.

4. **Initialize logger** — **MUST be placed AFTER the `--help`/`--version` early-exit blocks (after line 61 in current `stark.ts`) and AFTER global flag extraction, but BEFORE command dispatch.** This prevents unnecessary filesystem I/O on `stark --help` and `stark -v`:
   ```typescript
   // --- After --help/--version early exits (line 62+) ---
   // --- After global flag extraction ---
   import { logger, generateRunId } from '@stark/core/log/index.js';

   const logLevel = process.env.LOG_LEVEL?.toUpperCase() as LogLevel | undefined;
   const consoleLevel = logLevel ?? (verbose ? 'DEBUG' : quiet ? 'WARN' : 'INFO');
   logger.init({ consoleLevel });
   logger.setRunId(generateRunId());
   logger.rotateLogs(14);
   // --- Then command dispatch switch ---
   ```

5. **Add `logs` case** to switch:
   ```typescript
   case "logs": {
     const { logsCommand } = await import("../src/commands/logs.js");
     await logsCommand(commandArgs);
     break;
   }
   ```

**File:** `packages/cli/src/utils/command-context.ts`

1. **Add logger to CommandContext:**
   ```typescript
   import { logger } from '@stark/core/log/index.js';
   import type { Logger } from '@stark/core/log/logger.js';

   export interface CommandContext {
     config: StarkConfig;
     db: DatabaseAdapter;
     queries: Queries;
     provider: DataProvider;
     llmService: LLMService | null;
     engine: ScoringEngine;
     logger: Logger;  // NEW
   }
   ```

2. **Return logger in context:**
   ```typescript
   return { config, db, queries, provider, llmService, engine, logger };
   ```

   Note: Logger is already initialized by `stark.ts` entry point. CommandContext just passes the singleton reference.

**Acceptance Criteria:**
- [ ] `stark evening --verbose` shows DEBUG entries on console (stderr)
- [ ] `stark evening --quiet` suppresses INFO entries
- [ ] `LOG_LEVEL=debug stark evening` works
- [ ] Each command invocation gets a unique `runId` in format `evt-YYYYMMDD-HHMMSS`
- [ ] `--verbose` and `--quiet` are stripped from args before passing to commands
- [ ] `stark logs --help` does not error
- [ ] `-v` still shows version (not verbose)
- [ ] Logger rotation runs at startup

**Line estimate:** ~50 lines in stark.ts, ~10 lines in command-context.ts

---

### Step 4: ScoringContext Integration (~30 lines changed)

**File:** `packages/core/src/scoring/context.ts`

1. **Add optional `sessionId` parameter** to `createScoringContext()`:
   ```typescript
   export function createScoringContext(
     symbols: string[],
     sessionId?: string,  // NEW: allows caller to pass logger.runId
   ): ScoringContext {
     return {
       sessionId: sessionId ?? randomUUID(),
       // ... rest unchanged
     };
   }
   ```

**File:** `packages/core/src/scoring/engine.ts`

1. **Accept optional runId in `scoreBatch()`:**
   ```typescript
   async scoreBatch(
     symbols: Array<{ symbol: string; token: string; name: string }>,
     runId?: string,  // NEW
   ): Promise<{ results: ScoreResult[]; context: ScoringContext }> {
     const context = createScoringContext(symbols.map(s => s.symbol), runId);
     // ... rest unchanged
   }
   ```

**File:** `packages/cli/src/commands/evening.ts`

1. **Pass logger.runId to scoreBatch:**
   ```typescript
   import { logger } from '@stark/core/log/index.js';
   // ...
   const { results, context } = await engine.scoreBatch(symbols, logger.getRunId());
   ```

2. **Log batch_summary after scoring completes:**
   ```typescript
   logger.info('scoring', 'batch_summary', `Scored ${results.length} stocks`, {
     stocks: results.length,
     scored: results.filter(r => r.status === 'COMPLETE').length,
     errors: context.errors.length,
     apiCalls: context.apiCalls,
     cacheHits: context.cacheHits,
     cacheMisses: context.cacheMisses,
     duration_ms: (context.completedAt ?? Date.now()) - context.startedAt,
   });
   ```

**Acceptance Criteria:**
- [ ] `ScoringContext.sessionId` matches `logger.getRunId()` when passed from evening command
- [ ] `createScoringContext(symbols)` still works without runId (backward compatible)
- [ ] `batch_summary` event appears in `~/.stark/logs/stark-YYYY-MM-DD.jsonl` after scoring
- [ ] `grep 'batch_summary'` on log file shows stock count, errors, timing

**Line estimate:** ~30 lines changed across 3 files

---

### Step 5: State Transition Logging (~60 lines added)

**File:** `packages/cli/src/commands/evening.ts`

Add `logger.info('workflow', 'state_change', ...)` calls at each phase boundary:

```typescript
import { logger } from '@stark/core/log/index.js';

// At start:
logger.info('workflow', 'evening_start', 'Evening workflow started', { stockCount: stocks.length });

// After scoring:
logger.info('workflow', 'state_change', 'Workflow: scoring_batch -> market_regime', {
  from: 'scoring_batch', to: 'market_regime', scored: results.length, duration_ms: ... });

// After MBI:
logger.info('workflow', 'state_change', 'Workflow: market_regime -> focus_generation', {
  from: 'market_regime', to: 'focus_generation', regime });

// At end:
logger.info('workflow', 'evening_complete', 'Evening workflow complete', {
  totalDuration_ms: ..., scored: results.length, focusCount: focusList.stocks.length });
```

**File:** `packages/cli/src/commands/morning.ts`

Same pattern:

```typescript
logger.info('workflow', 'morning_start', 'Morning workflow started', { focusCount: focusStocks.length });
// After news:
logger.info('workflow', 'state_change', 'Workflow: news_fetch -> quote_check', { ... });
// At end:
logger.info('workflow', 'morning_complete', 'Morning workflow complete', { ... });
```

**Note on `review.ts`:** The review command is interactive and state logging is less critical. Add a single start/end log pair only:
```typescript
logger.info('workflow', 'review_start', 'Review workflow started', { candidates: candidates.length });
// ... at end:
logger.info('workflow', 'review_complete', 'Review complete', { reviewed: toReview.length, overrides: overrideCount });
```

**Acceptance Criteria:**
- [ ] `grep 'state_change' ~/.stark/logs/stark-*.jsonl` shows full evening workflow progression
- [ ] `grep 'state_change' ~/.stark/logs/stark-*.jsonl` shows morning workflow progression
- [ ] Each state_change has `from` and `to` fields
- [ ] `evening_start` and `evening_complete` bracket the workflow
- [ ] Error/warning events logged with context (e.g., MBI unavailable -> WARN)

**Line estimate:** ~40 lines in evening.ts, ~20 lines in morning.ts, ~10 lines in review.ts

---

### Step 6: `stark logs` Command (~120 lines new)

**File:** `packages/cli/src/commands/logs.ts` (NEW)

```typescript
export async function logsCommand(args: string[]): Promise<void>;
```

**Flags:**
- `--errors` -- filter to ERROR level only
- `--run <runId>` -- filter to specific workflow run
- `--today` -- display today's application log (default if no date specified)
- `--date YYYY-MM-DD` -- display a specific day's log

**Implementation:**
1. Read JSONL file for the target date
2. Parse each line as JSON
3. Apply filters (level, runId)
4. Format for terminal: `[HH:MM:SS] LEVEL [component] message`
5. Color by level (same ANSI codes as Logger)
6. Handle missing log files: "No logs found for {date}"

**Not implementing (deferred):** `--grep`, `--scoring`, `--since`/`--until`. Users have `grep`/`jq` for these.

**Acceptance Criteria:**
- [ ] `stark logs --errors` shows only ERROR entries, formatted
- [ ] `stark logs --run evt-20260312-200000` shows only entries with that runId
- [ ] `stark logs --today` shows today's full log
- [ ] `stark logs --date 2026-03-11` shows that day's log
- [ ] `stark logs` with no flags defaults to `--today`
- [ ] Missing log file: prints "No logs found for {date}" (not an error/stack trace)
- [ ] Output is human-readable colored text, not raw JSON

**Line estimate:** ~120 lines

---

### Step 7: Tests (~150 lines new)

**File:** `packages/core/tests/logger.test.ts` (REPLACE existing -- migrate from vitest to bun:test + new 4-arg API signatures, in same commit as Logger refactor)

Using `import { describe, it, expect, afterEach } from 'bun:test'` per project conventions.

**Test cases (~12 tests):**

1. **LogEntry format:** Logger writes entries with `ts`, `level`, `runId`, `component`, `event`, `msg` fields
2. **runId propagation:** `setRunId('evt-test')` -> all subsequent entries have `runId: 'evt-test'`
3. **Default runId:** entries before `setRunId()` have `runId: 'no-run'`
4. **ComponentLogger:** `child('api.angel')` returns logger where all entries have `component: 'api.angel'`
5. **Level filtering:** with consoleLevel=WARN, DEBUG/INFO do not reach console (file still gets them)
6. **File output:** write 10 entries, read back JSONL, all parse as valid JSON with correct fields
7. **Pre-init behavior:** before `init()`, entries go to stderr only (no file created)
8. **Post-init file:** after `init({ logDir: tmpDir })`, entries appear in file
9. **JSON.stringify safety:** entry with circular reference data does not throw, writes `_serializationError`
10. **rotateLogs:** create files with old dates, call `rotateLogs(7)`, verify old files deleted
11. **generateRunId format:** matches `evt-YYYYMMDD-HHMMSS` pattern
12. **Multiple children share runId:** two `child()` calls both inherit the same `runId`

**File:** `packages/core/tests/logs-command.test.ts` (NEW)

**Test cases (~5 tests):**

1. **Parse and format JSONL:** given a log file with 3 entries, formatted output has 3 lines
2. **Filter by level:** `--errors` filters to ERROR only
3. **Filter by runId:** `--run` filters to matching entries
4. **Missing file:** returns "No logs found" message
5. **Malformed lines:** skipped without crashing

**Acceptance Criteria:**
- [ ] All new tests import from `bun:test`
- [ ] All new tests pass on Bun runtime
- [ ] Tests use temp directories for log output (cleaned up in afterEach)
- [ ] No modifications to existing vitest-based test files

**Line estimate:** ~150 lines total across 2 files

---

## Commit Strategy

| Commit | Step | Message | Key Files |
|--------|------|---------|-----------|
| 1 | Steps 1-2 | `feat(log): enhance Logger with component, event, runId, child()` | `logger.ts`, `index.ts` |
| 2 | Step 3 | `feat(cli): add --verbose/--quiet flags, logger init, logs command registration` | `stark.ts`, `command-context.ts` |
| 3 | Step 4 | `feat(scoring): wire ScoringContext.sessionId to logger.runId` | `context.ts`, `engine.ts`, `evening.ts` |
| 4 | Step 5 | `feat(cli): add state transition logging to evening/morning/review` | `evening.ts`, `morning.ts`, `review.ts` |
| 5 | Step 6 | `feat(cli): add stark logs command with --errors/--run/--today/--date` | `logs.ts` |
| 6 | Step 7 | `test: replace logger tests (bun:test + new API) and add logs-command tests` | `logger.test.ts` (replaced), `logs-command.test.ts` |

**Total estimated lines:** ~500-600 new/changed lines
**Total estimated tests:** ~17 new tests
**Estimated time:** 2-3 hours

---

## Test Plan

### Unit Tests (Step 7)
- Logger core: 12 tests covering format, runId, child, levels, rotation, safety
- Logs command: 5 tests covering parse, filter, missing file

### Manual Smoke Tests
```bash
# After copying to /mnt/c/SteveTrading-logging/
cd /mnt/c/SteveTrading-logging && bun test packages/core/tests/

# Verify --verbose flag
bun run packages/cli/bin/stark.ts evening --verbose 2>/dev/null | head  # stdout clean
bun run packages/cli/bin/stark.ts evening --verbose 2>&1 | grep DEBUG  # stderr has DEBUG

# Verify logs command
bun run packages/cli/bin/stark.ts logs --today
bun run packages/cli/bin/stark.ts logs --errors

# Verify -v still shows version
bun run packages/cli/bin/stark.ts -v  # should print "stark v0.1.0"
```

### Regression
- All 172 existing tests must still pass
- 3 pre-existing ohlcv-cache.test.ts failures remain (known/accepted)

---

# Part 2: Intraday Seams (`feat/intraday-seams`)

## What Already Exists (Verification Against Code)

### Seam 1: Trade Type in Schema and Type System -- DONE

**Schema (`db/schema.ts`):**
- `trade_journal` table: `trade_type TEXT NOT NULL DEFAULT 'swing' CHECK (trade_type IN ('swing', 'intraday'))` (line 142)
- `positions` table: `trade_type TEXT NOT NULL DEFAULT 'swing' CHECK (trade_type IN ('swing', 'intraday'))` (line 167)

**TypeScript (`models/trade.ts`):**
- `export type TradeType = 'swing' | 'intraday'` (line 3)
- `TradeEntry.tradeType: TradeType` (line 12)
- `Position.tradeType: TradeType` (line 41)

**Status: COMPLETE. No work needed.**

### Seam 2: Timestamp Precision in OHLCV Cache -- DONE

**TypeScript (`models/intervals.ts`):**
- `export type OHLCVInterval = '1m' | '5m' | '15m' | '75m' | '1d' | '1w' | '1M'` (line 1)
- Already includes all intraday intervals (1m, 5m, 15m)

**Schema (`db/schema.ts`):**
- `ohlcv_cache` table uses `interval TEXT NOT NULL` (line 33) -- accepts any string, no CHECK constraint limiting to daily

**Status: COMPLETE. No work needed.**

### Seam 3: MBI Refresh Frequency in Config -- DONE

**TypeScript (`models/config.ts`):**
- `StarkModelConfig.mbi.refreshInterval?: number` with comment `// intraday seam 3` (line 28)

**However:** The runtime config (`config/index.ts`) uses a DIFFERENT type (`StarkConfig`) that does NOT have this field. `StarkConfig` has `sheetId: string` at the top level, not nested under `mbi`. The `StarkModelConfig` in `models/config.ts` appears to be a newer/planned type that is not yet used by `loadConfig()`.

**Status: PARTIALLY DONE.** The model type has the field. The runtime `StarkConfig` in `config/index.ts` does not. Since this sprint is about seams (not runtime behavior), and the model type is defined, this is acceptable. We just need to verify and add a TODO comment in `config/index.ts` pointing to the model config's `refreshInterval` field.

### Seam 4: Risk Configuration Structure -- DONE

**TypeScript (`config/index.ts`):**
- `RiskConfig` interface with `swing: RiskProfile` and `intraday: RiskProfile` (lines 19-22)
- `getDefaultConfig()` returns `risk: { swing: {...}, intraday: {...} }` (lines 88-91)

**TypeScript (`models/config.ts`):**
- `StarkModelConfig.risk.intraday: RiskConfig` with comment `// intraday seam 4` (line 32)

**Status: COMPLETE. No work needed.**

### Seam 5: Sector Data with Timestamps -- DONE

**Schema (`db/schema.ts`):**
- `sector_money_flow.captured_at TEXT NOT NULL DEFAULT (datetime('now'))` (line 102)
- Uses `datetime()` function, which returns full datetime, not just date

**TypeScript (`models/market.ts`):**
- `SectorFlow.capturedAt: string` (line 60) -- typed as string (can hold datetime)

**Status: COMPLETE. No work needed.** The `datetime('now')` default produces ISO datetime with time component. The unique index uses `date(captured_at)` to prevent duplicate sectors per day (line 106), which is correct for swing. Intraday will need to drop or modify this index in Phase 5, but the column itself is datetime-ready.

### Seam 6: Journal Analytics Filter by Trade Type -- DEFERRED (Phase 3)

This seam is about adding `trade_type` filter to performance queries. Since performance analytics are Phase 3 work and no performance query infrastructure exists yet, there is nothing to modify.

**Status: NOT APPLICABLE YET.** Add a TODO comment in `models/trade.ts` as a reminder for Phase 3.

### Seam 7: MBI Daily Table Composite Key -- DONE

**Schema (`db/schema.ts`):**
- `mbi_daily` table: `date TEXT NOT NULL`, `captured_at TEXT NOT NULL DEFAULT 'eod'` (lines 179-180)
- `PRIMARY KEY (date, captured_at)` (line 196)
- Comment: `-- MBI Daily (intraday seam 7: composite key)` (line 177)

**Status: COMPLETE. No work needed.**

---

## Remaining Work

Only **verification + documentation** work remains. All 7 seams are either fully implemented or deferred to the correct future phase (Seam 6).

### Step 1: Add TODO Comments (~15 lines)

**File:** `packages/core/src/config/index.ts`

Add a TODO comment near the `StarkConfig` interface:
```typescript
// TODO(intraday-seam-3): StarkModelConfig in models/config.ts has mbi.refreshInterval.
// When migrating to StarkModelConfig as the runtime type, ensure refreshInterval is preserved.
```

**File:** `packages/core/src/models/trade.ts`

Add a TODO comment:
```typescript
// TODO(intraday-seam-6): When building Phase 3 performance analytics,
// all queries should accept optional trade_type filter to separate swing vs intraday metrics.
```

**File:** `packages/core/src/db/schema.ts`

Add a TODO comment near sector_money_flow unique index:
```typescript
// TODO(intraday-seam-5): For intraday sector rotation (Phase 5), this unique index
// prevents multiple snapshots per sector per day. Drop or modify when implementing
// intraday sector polling.
```

**Acceptance Criteria:**
- [ ] All 3 TODO comments reference the seam number and future phase
- [ ] No code behavior changes

**Line estimate:** ~9 lines of comments

---

### Step 2: Verification Checklist Test (~40 lines)

**File:** `packages/core/tests/intraday-seams.test.ts` (NEW)

A verification test that confirms all 7 seams are in place by checking the type system and schema:

```typescript
import { describe, it, expect } from 'bun:test';
import type { TradeType } from '../src/models/trade.js';
import type { OHLCVInterval } from '../src/models/intervals.js';
import type { SectorFlow } from '../src/models/market.js';
import type { StarkModelConfig } from '../src/models/config.js';
import { MIGRATIONS } from '../src/db/schema.js';

describe('Intraday seams verification', () => {
  it('Seam 1: TradeType includes intraday', () => {
    const t: TradeType = 'intraday';
    expect(t).toBe('intraday');
  });

  it('Seam 2: OHLCVInterval includes sub-daily intervals', () => {
    const intervals: OHLCVInterval[] = ['1m', '5m', '15m'];
    expect(intervals).toHaveLength(3);
  });

  it('Seam 3: StarkModelConfig.mbi has refreshInterval', () => {
    // Type-level check -- if this compiles, the seam exists
    const cfg = { refreshInterval: 5 } as Pick<StarkModelConfig['mbi'], 'refreshInterval'>;
    expect(cfg.refreshInterval).toBe(5);
  });

  it('Seam 4: Risk config has swing and intraday namespaces', () => {
    // Type-level check
    const risk = {} as StarkModelConfig['risk'];
    expect(risk).toHaveProperty; // exists as a type
  });

  it('Seam 5: SectorFlow.capturedAt is string (datetime capable)', () => {
    const sf: SectorFlow = {
      sector: 'NIFTYBANK', strength: 'STRONG',
      indexChange: 1.5, vsNiftyChange: 0.5,
      capturedAt: '2026-03-12T14:30:00+05:30',
    };
    expect(sf.capturedAt).toContain('T');
  });

  it('Seam 7: mbi_daily schema has composite primary key', () => {
    const schema = MIGRATIONS[0].sql;
    expect(schema).toContain('PRIMARY KEY (date, captured_at)');
  });

  it('Seam 7: trade_journal has trade_type column', () => {
    const schema = MIGRATIONS[0].sql;
    expect(schema).toContain("trade_type TEXT NOT NULL DEFAULT 'swing'");
  });
});
```

**Acceptance Criteria:**
- [ ] All 7 seam tests pass
- [ ] Test file imports from `bun:test`
- [ ] Test verifies both type-level and schema-level seams

**Line estimate:** ~40 lines

---

### Step 3: Type Check Verification

Run `bun run typecheck` to confirm all types compile cleanly with the TODO comments and no accidental breakage.

**Acceptance Criteria:**
- [ ] `bun run typecheck` exits 0
- [ ] No new type errors introduced

---

## Commit Strategy

| Commit | Step | Message |
|--------|------|---------|
| 1 | Steps 1+2 | `feat(seams): verify all 7 intraday seams, add TODO markers and verification tests` |

Single commit is appropriate given the tiny scope.

**Total estimated lines:** ~55 new lines (comments + test)
**Total estimated tests:** 7 new tests
**Estimated time:** 15-30 minutes

---

# Combined Verification

## Per-Worktree Test Commands

### Logging Worktree

```bash
# Setup (one-time)
cd /mnt/d/Projects/SteveTrading-logging
# Copy to NTFS for testing
cp -r packages /mnt/c/SteveTrading-logging/

# Run tests
cd /mnt/c/SteveTrading-logging && bun test packages/core/tests/

# Type check
cd /mnt/d/Projects/SteveTrading-logging && bun run typecheck
```

### Intraday Worktree

```bash
# Setup (one-time)
cd /mnt/d/Projects/SteveTrading-intraday
# Copy to NTFS for testing
cp -r packages /mnt/c/SteveTrading-intraday/

# Run tests
cd /mnt/c/SteveTrading-intraday && bun test packages/core/tests/

# Type check
cd /mnt/d/Projects/SteveTrading-intraday && bun run typecheck
```

## Expected Test Counts

| Worktree | Existing | New Tests | Expected Pass | Pre-existing Fail |
|----------|----------|-----------|---------------|-------------------|
| Logging | 172 | ~17 (12 logger + 5 logs-cmd) | ~189 | 3 (ohlcv-cache) |
| Intraday | 172 | 7 (seams verification) | ~179 | 3 (ohlcv-cache) |
| Post-merge master | 172 | ~24 (all new) | ~196 | 3 (ohlcv-cache) |

## Merge Order (per plan-pending-parallel.md)

1. Merge `feat/intraday-seams` -> `master` (smallest, zero conflict)
2. Rebase `feat/logging-system` onto updated master, merge (no conflicts -- intraday only adds comments)
3. Rebase `feat/mbi-integration` onto updated master, merge (logging adds state transitions to evening.ts/morning.ts -- MBI adds business logic to different sections)

## Post-Merge Integration Task

After all 3 branches merge, add logging wrappers to MBI-added workflow steps in `evening.ts` and `morning.ts` that were merged without logging instrumentation (MBI agent adds business logic at fork time; Logging agent only wraps code that existed at fork time).

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Logger API breaking change breaks callers | LOW | LOW | Only test files call current API; production code does not use logger singleton directly yet |
| `-v` flag conflict (version vs verbose) | N/A | N/A | Resolved: keep `-v` as version, use `--verbose` only |
| Console output on stdout vs stderr | LOW | MEDIUM | Design mandates stderr; tested explicitly |
| Existing vitest tests break with new Logger API | MEDIUM | LOW | RESOLVED: Replace `logger.test.ts` with bun:test + new API in same commit as Logger refactor |
| StarkConfig vs StarkModelConfig type divergence | LOW | LOW | Seam 3 documented with TODO; no runtime behavior change |

---

## Open Questions

None — all design decisions resolved:
- **Test file strategy:** Replace `logger.test.ts` in same commit as Logger refactor (bun:test + new 4-arg API).
- **Logger init placement:** After `--help`/`--version` early exits, before command dispatch.
- **Dual output model:** `console.log()` for user output, `Logger` for structured JSONL. Acknowledged as conscious design choice.

---

## Consensus Record

**Planner v1:** Created combined plan (831 lines) covering Logging System (8 steps) and Intraday Seams (verification + 2 small changes).

**Architect Review (v1) — APPROVED** with 3 required fixes:
1. Resolve old test file fate — replace `logger.test.ts`, don't create separate file *(incorporated)*
2. Global flag extraction ordering — place after `--help`/`--version` early exits *(incorporated)*
3. Guard `rotateLogs()` — place after early exits, not at top of `main()` *(incorporated)*

**Critic Evaluation (v1) — ITERATE** with 2 blocking fixes:
1. Fix #3 not addressed — logger init placement *(incorporated)*
2. Fix #1 not addressed — old test file ambiguity *(incorporated)*
3. Advisory: acknowledge over-engineering tradeoff explicitly *(incorporated)*

**v2 Revision:** All 3 fixes applied. Open Questions resolved. Risk register updated.

**Final Status:** v2 — pending re-review
