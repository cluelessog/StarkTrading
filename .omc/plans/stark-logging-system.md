# Stark-Trading Logging & Observability Plan

**Created:** 2026-03-04
**Status:** v2 — Revised per Architect/Critic feedback
**Scope:** Logging/observability system for Stark scoring engine
**Developer:** Solo developer, personal trading tool

---

## Context

Stark-Trading is a CLI-first stock scoring tool (Bun + TypeScript + SQLite) that runs evening/morning workflows scoring 30-50 stocks across 8 algorithmic factors, calling multiple external APIs (Angel One, NSE, Screener.in, News API, optionally Gemini/Perplexity). The existing implementation plan already defines three observability primitives:

1. **Scoring Log** -- JSONL append-only log for every factor calculation (`~/.stark/logs/`)
2. **ScoringContext** -- Per-batch metrics (API calls, cache hits, errors, timing)
3. **API Call Tracker** -- Daily counts per service

These three cover *scoring-specific* observability well. What is missing is **general application logging** -- the connective tissue that lets you trace what happened when something breaks outside of scoring (CLI startup, workflow orchestration, API auth, DB operations, config loading, etc.).

This plan designs a lightweight logging layer that integrates with (not replaces) the existing scoring observability.

---

## Work Objectives

Build a unified logging system that:
1. Makes any failure traceable to root cause within 2 minutes of reading logs
2. Records state transitions (workflow phases, auth state, scoring batch lifecycle)
3. Integrates cleanly with the existing Scoring Log, ScoringContext, and API Tracker
4. Adds zero perceptible latency to scoring workflows
5. Stays simple enough for a solo developer to maintain

---

## Guardrails

### Must Have
- Structured log format (parseable, not just `console.log`)
- Correlation IDs linking related events across a workflow run
- Log levels (ERROR, WARN, INFO, DEBUG)
- File-based log output (survives terminal close)
- Console output with configurable verbosity
- State transition logging for workflow phases
- Error context capture (stack traces, API response codes, input data)
- Log rotation (don't fill the disk)

### Must NOT Have
- External logging services (Datadog, Sentry, etc.)
- Separate log viewer UI in Phase 1-2 (CLI grep is sufficient)
- Database-backed log storage (SQLite for logs adds complexity for minimal gain)
- Async log shipping or buffering (overkill for local CLI tool)
- Custom log query language (grep + jq covers this)
- Per-request tracing spans (this is not a distributed system)

---

## RALPLAN-DR Summary

### Guiding Principles

1. **Grep-friendly over query-friendly:** Structured JSONL that works with `grep`, `jq`, and `cat`. No specialized tooling required.
2. **Correlation over aggregation:** A single `runId` linking all events in one workflow run is more useful than dashboards or metrics.
3. **Layered verbosity:** Console shows what matters now (WARN+). Files capture everything (DEBUG+). The user controls the dial.
4. **Zero-dependency where possible:** Bun has `console` and `Bun.file()`. Avoid npm logging libraries that may not work on Bun or add weight.
5. **Integrate, don't duplicate:** The Scoring Log already captures factor-level detail. The application log captures everything else and cross-references via `runId`.

### Decision Drivers

1. **Debuggability:** When a score looks wrong or an API fails, the developer needs to reconstruct the full sequence of events in under 2 minutes.
2. **Bun compatibility:** Many Node.js logging libraries (winston, pino) may have Bun compatibility issues. Native Bun APIs are safer.
3. **Solo developer overhead:** The logging system itself should take <1 day to implement and near-zero effort to maintain.

### Options Considered

#### Option A: Custom JSONL Logger (RECOMMENDED)

A thin custom logger (~100-150 lines) that writes structured JSONL to files, with console output via `Bun.stderr.write()`.

**Pros:**
- Zero dependencies, guaranteed Bun compatibility
- Full control over format, rotation, and output
- Integrates directly with existing ScoringContext `session_id` as correlation ID
- JSONL format matches existing Scoring Log format (consistency)
- Can be built in 2-3 hours

**Cons:**
- No built-in log level filtering at query time (use `jq` or `grep`)
- Must implement rotation manually (trivial: rename + delete)
- No structured context inheritance (manually pass `runId`)

#### Option B: Pino Logger

Use `pino` (lightweight, fast, structured JSON logger popular in Node.js).

**Pros:**
- Battle-tested, fast (uses `sonic-boom` for async writes)
- Built-in log levels, child loggers, serializers
- `pino-pretty` for human-readable console output
- Ecosystem: `pino-roll` for rotation

**Cons:**
- Bun compatibility uncertain (sonic-boom uses Node.js streams internally)
- Adds 3-4 dependencies to a minimal project
- Async write buffering may lose last entries on crash
- Over-engineered for a CLI tool that runs for 2 minutes then exits

**Invalidation rationale:** Bun compatibility risk is the primary concern. Pino's async writer (`sonic-boom`) relies on Node.js `fs.createWriteStream` internals. While it may work on Bun today, it is a fragile dependency for a core infrastructure component. The feature set (child loggers, serializers, transports) exceeds what a solo-dev CLI tool needs.

#### Option C: Console-only + Scoring Log expansion

Skip application logging entirely. Expand the existing Scoring Log to capture non-scoring events.

**Pros:**
- Least work -- no new files or systems
- Single log to search

**Cons:**
- Scoring Log has a specific schema (`symbol, factor, result, reasoning`) that does not fit general events
- Mixing concerns makes the Scoring Log harder to parse for its primary purpose
- No log levels, no structured error context
- Console output lost when terminal closes

**Invalidation rationale:** Mixing general application events into the Scoring Log corrupts its purpose (factor-level audit trail). The Scoring Log schema does not accommodate workflow state, auth events, or general errors without awkward overloading.

---

## Detailed Design

### 1. Log Architecture (Three Layers)

```
Layer 1: Application Log (NEW)         -- General events, errors, state transitions
Layer 2: Scoring Log (EXISTS)           -- Factor-level scoring detail (JSONL)
Layer 3: ScoringContext + API Tracker   -- Per-batch metrics (in-memory + DB)
```

**Correlation:** All three layers share a `runId` (generated at workflow start). The Application Log references the Scoring Log entries. The ScoringContext's `session_id` IS the `runId`.

### 2. Application Log Format

```jsonl
{"ts":"2026-03-04T20:00:01.234Z","level":"INFO","runId":"evt-20260304-200000","component":"workflow","event":"evening_start","msg":"Evening workflow started","data":{"stockCount":42,"watchlist":"priority-0"}}
{"ts":"2026-03-04T20:00:01.456Z","level":"DEBUG","runId":"evt-20260304-200000","component":"api.angel","event":"auth_check","msg":"Session token valid","data":{"expiresAt":"2026-03-04T23:59:00Z"}}
{"ts":"2026-03-04T20:00:02.789Z","level":"WARN","runId":"evt-20260304-200000","component":"api.nse","event":"fallback_triggered","msg":"NSE sector API failed, using cached data","data":{"error":"ETIMEDOUT","cachedAge":"4h","fallbackLevel":1}}
{"ts":"2026-03-04T20:00:15.123Z","level":"ERROR","runId":"evt-20260304-200000","component":"scoring.ep_catalyst","event":"factor_error","msg":"EP catalyst failed for TATAMOTORS","data":{"symbol":"TATAMOTORS","error":"News API 429","stack":"..."}}
```

**Fields:**
- `ts` -- ISO 8601 timestamp (millisecond precision)
- `level` -- `ERROR` | `WARN` | `INFO` | `DEBUG`
- `runId` -- Correlation ID for the current workflow run (format: `evt-YYYYMMDD-HHMMSS`)
- `component` -- Dot-notation source (e.g., `api.angel`, `scoring.ep_catalyst`, `workflow`, `db`, `cache`, `cli`)
- `event` -- Machine-readable event name (snake_case, greppable)
- `msg` -- Human-readable description
- `data` -- Structured payload (varies per event, optional)

### 3. Log Levels

| Level | When to Use | Console | File |
|-------|-------------|---------|------|
| **ERROR** | Something failed and a result is missing or wrong | Always shown (red) | Always written |
| **WARN** | Degraded operation -- fallback used, stale data, slow response | Always shown (yellow) | Always written |
| **INFO** | Key lifecycle events -- workflow start/end, batch complete, focus list generated | Default shown | Always written |
| **DEBUG** | Detailed internals -- API request/response, cache hit/miss, factor inputs | Hidden by default | Written when `--verbose` or `LOG_LEVEL=debug` |

**Console verbosity control:**
- Default: `INFO` and above
- `--verbose` or `-v` flag: `DEBUG` and above
- `--quiet` or `-q` flag: `WARN` and above
- `LOG_LEVEL` env var: override (values: `debug`, `info`, `warn`, `error`)

### 4. Log Destinations

```
~/.stark/logs/
  stark-2026-03-04.jsonl      # Application log (daily rotation)
  scoring-2026-03-04.jsonl    # Scoring log (already planned, daily rotation)
```

- **File:** JSONL, one file per day, synchronous append via `Bun.file().writer()`
- **Console:** Formatted human-readable output via `Bun.stderr.write()` (stderr so it does not interfere with piped stdout)
- **Rotation:** Daily files. Keep 14 days. `stark status` shows log disk usage. Cleanup runs at workflow start (delete files older than 14 days).

### 5. State Transition Logging

Key states to track with INFO-level log entries.

> **Note:** These state diagrams are initial approximations. Actual states will be defined when workflow commands are implemented in Phase 2. The executor should implement the `state_change` logging mechanism but adapt the specific state names to match the actual workflow code, not this diagram.

```
WORKFLOW STATES:
  idle -> evening_start -> auth_check -> market_data_fetch -> scoring_batch ->
  review_pending -> focus_generation -> evening_complete

  idle -> morning_start -> gap_check -> news_fetch -> validation -> morning_complete

AUTH STATES:
  unauthenticated -> authenticating -> authenticated -> token_expired

SCORING BATCH STATES (per stock):
  queued -> fetching_data -> scoring -> partial_complete -> review_pending -> complete

API STATES (per request):
  requesting -> success | failed -> fallback_1 -> success | failed -> fallback_2 -> ...
```

Each transition logged as:
```jsonl
{"ts":"...","level":"INFO","runId":"...","component":"workflow","event":"state_change","msg":"Workflow: scoring_batch -> review_pending","data":{"from":"scoring_batch","to":"review_pending","scored":42,"errors":2,"duration_ms":28500}}
```

### 6. Error Tracing Strategy

When an error occurs, capture:

```typescript
interface ErrorLogEntry {
  error: string;        // Error message
  code?: string;        // Error code (e.g., "ETIMEDOUT", "API_429")
  stack?: string;       // Stack trace (ERROR level only, truncated to 10 lines)
  symbol?: string;      // Which stock, if applicable
  factor?: string;      // Which factor, if applicable
  apiService?: string;  // Which API service
  requestUrl?: string;  // API URL (with secrets redacted)
  responseStatus?: number;
  fallbackUsed?: string; // What fallback was triggered
  inputSummary?: object; // Sanitized input data that caused the error
}
```

**Correlation for debugging:**
1. Find the error: `grep '"level":"ERROR"' ~/.stark/logs/stark-2026-03-04.jsonl`
2. Get the runId from the error entry
3. See full context: `grep '<runId>' ~/.stark/logs/stark-2026-03-04.jsonl`
4. Cross-reference scoring detail: `grep '<runId>' ~/.stark/logs/scoring-2026-03-04.jsonl`
5. Check batch metrics: `grep '<runId>' ~/.stark/logs/stark-2026-03-04.jsonl | grep 'batch_summary'`

### 7. Logger Implementation

```typescript
// packages/core/src/log/logger.ts (~120 lines)

type LogLevel = 'ERROR' | 'WARN' | 'INFO' | 'DEBUG';

interface LogEntry {
  ts: string;
  level: LogLevel;
  runId: string;
  component: string;
  event: string;
  msg: string;
  data?: Record<string, unknown>;
}

class StarkLogger {
  private writer: FileSink | null = null;
  private runId: string = 'no-run';
  private consoleLevel: LogLevel = 'INFO';
  private initialized: boolean = false;

  // PRE-INIT BEHAVIOR: Before init() is called, all log methods write to
  // stderr only (no file output). The logger starts in consoleOnly mode
  // and transitions to file+console mode after init(). This ensures logging
  // during CLI bootstrap, config loading, and error paths before logger
  // initialization does not silently discard messages or throw.

  // Set at workflow start, shared with ScoringContext.session_id
  setRunId(id: string): void;

  // Create a child logger with a fixed component prefix
  child(component: string): ComponentLogger;

  // Core logging methods
  error(component: string, event: string, msg: string, data?: Record<string, unknown>): void;
  warn(component: string, event: string, msg: string, data?: Record<string, unknown>): void;
  info(component: string, event: string, msg: string, data?: Record<string, unknown>): void;
  debug(component: string, event: string, msg: string, data?: Record<string, unknown>): void;

  // Lifecycle
  init(options: { logDir: string; consoleLevel: LogLevel }): void;
  flush(): void;
  rotateLogs(retainDays: number): void;
}

// Singleton export
export const logger: StarkLogger;
```

**ComponentLogger** (convenience wrapper):
```typescript
// Usage in API client:
const log = logger.child('api.angel');
log.info('fetch_ohlcv', 'Fetching OHLCV for RELIANCE', { symbol: 'RELIANCE', interval: 'daily' });
log.warn('rate_limited', 'Rate limit hit, backing off', { retryAfter: 1000 });
```

### 8. Integration with Existing Systems

| Existing System | Integration Point |
|----------------|-------------------|
| **Scoring Log** | Shares `runId`. Application log records batch-level events; Scoring Log records factor-level detail. No duplication. |
| **ScoringContext** | `ScoringContext.session_id` = `runId`. At batch end, ScoringContext summary written to application log as `batch_summary` event. |
| **API Tracker** | API tracker counts are logged as `api_usage_summary` event at workflow end. Daily totals still persisted to DB. |
| **CLI commands** | Each CLI command sets `runId` on start, calls `logger.init()`. `--verbose`/`--quiet` flags control console level. |
| **Fallback chains** | Each fallback step logged as WARN with `fallback_triggered` event, including which level and what data source was used. |

### 9. CLI Integration

```bash
# Normal operation (INFO+ to console, DEBUG+ to file)
stark evening

# Verbose mode (DEBUG to console too)
stark evening --verbose

# Quiet mode (WARN+ to console only)
stark evening --quiet

# View today's errors
stark logs --errors

# View full log for today
stark logs --today

# View logs for a specific run
stark logs --run evt-20260304-200000

# Search logs
stark logs --grep "TATAMOTORS"

# Log stats
stark status  # includes: log file sizes, days retained, error count today
```

The `stark logs` command is a thin wrapper around file reads + `grep` + `jq`-style filtering. It reads JSONL and formats for terminal display.

### 10. Performance Considerations

- **Synchronous writes:** Acceptable because Stark runs for ~2 minutes and writes <1000 log lines per session. Async buffering would add complexity for no measurable gain.
- **File I/O:** `Bun.file().writer()` with `append: true`. One open file handle per session.
- **Serialization:** `JSON.stringify()` per entry. At <1000 entries, this is <1ms total.
- **Console formatting:** Only format entries that pass the level filter. Skip string formatting for filtered-out entries.
- **No impact on scoring:** Logger calls are non-blocking synchronous writes. A single `JSON.stringify` + file append takes <0.1ms.

---

## Task Flow

```
Step 1: Logger core + file output        (in Phase 1, Step 1.1 -- infrastructure)
  |
  v
Step 2: Console formatter + CLI flags    (in Phase 1, Step 1.1 -- CLI entry point)
  |
  v
Step 3: Integration with ScoringContext  (in Phase 1, Step 1.3 -- scoring engine)
  |
  v
Step 4: State transition logging         (in Phase 2, Step 2.3 -- workflows)
  |
  v
Step 5: `stark logs` command             (in Phase 2, Step 2.3 -- after workflows work)
```

---

## Detailed TODOs

### Step 1: Logger Core + File Output

**Location:** `packages/core/src/log/logger.ts`

- Implement `StarkLogger` class (~120 lines):
  - `init()`: create log directory, open file writer for today's date, set console level
  - `log()`: internal method -- serialize to JSONL, write to file, optionally write to console
  - `error()`, `warn()`, `info()`, `debug()`: level-specific convenience methods
  - `child(component)`: return a `ComponentLogger` with fixed component prefix
  - `setRunId(id)`: set correlation ID for current workflow run
  - `flush()`: flush file writer
  - `rotateLogs(retainDays)`: delete log files older than N days
- Generate `runId` format: `evt-YYYYMMDD-HHMMSS` (simple, sortable, greppable)
- Console output: colored level prefix + message on stderr. DEBUG entries show component. ERROR entries show first line of stack.
- Log file path: `~/.stark/logs/stark-YYYY-MM-DD.jsonl`
- **JSON.stringify safety:** Wrap `JSON.stringify(data)` in a try-catch inside the internal `log()` method. On failure (circular reference, BigInt, or other non-serializable value), fall back to `JSON.stringify({ _serializationError: error.message, _type: typeof data })`. The logger must never crash the application.

**Acceptance Criteria:**
- Logger writes valid JSONL to `~/.stark/logs/stark-YYYY-MM-DD.jsonl`
- Each entry has `ts`, `level`, `runId`, `component`, `event`, `msg`
- Console output respects log level setting
- `rotateLogs(14)` deletes files older than 14 days
- Child loggers inherit `runId` and prepend component name
- Unit test: write 100 entries, read back and parse as JSON

### Step 2: Console Formatter + CLI Flags

**Location:** `packages/cli/src/commands/*.ts` (all commands), `packages/cli/bin/stark.ts` (flag parsing)

- Add global CLI flags: `--verbose` / `-v`, `--quiet` / `-q`
- Support `LOG_LEVEL` environment variable
- Call `logger.init()` at CLI entry point with resolved log level
- Generate and set `runId` at the start of each command
- Call `logger.rotateLogs(14)` at startup (non-blocking cleanup)

**Acceptance Criteria:**
- `stark evening --verbose` shows DEBUG entries on console
- `stark evening --quiet` suppresses INFO entries
- `LOG_LEVEL=debug stark evening` works
- Each command invocation gets a unique `runId`

### Step 3: Integration with ScoringContext + API Tracker

**Location:** `packages/core/src/scoring/context.ts`, `packages/core/src/utils/api-tracker.ts`

- Set `ScoringContext.session_id` = `logger.runId` at batch start
- At batch end, log `batch_summary` event with ScoringContext metrics:
  ```jsonl
  {"level":"INFO","event":"batch_summary","data":{"stocks":42,"scored":40,"errors":2,"apiCalls":{"angel":120,"nse":11,"news":38},"cacheHits":84,"cacheMisses":36,"duration_ms":28500}}
  ```
- In API clients, add logger calls:
  - DEBUG: every request (URL, params)
  - WARN: fallback triggered
  - ERROR: request failed after all fallbacks
- API tracker daily summary logged as INFO at workflow end

**Acceptance Criteria:**
- ScoringContext `session_id` matches application log `runId`
- `batch_summary` event appears in application log after each scoring batch
- API requests logged at DEBUG level with timing
- Fallback events logged at WARN level

### Step 4: State Transition Logging

**Location:** `packages/cli/src/commands/evening.ts`, `morning.ts`, `review.ts`

- Log state transitions at each workflow phase boundary (INFO level)
- Include timing: duration in previous state
- Log auth state changes (unauthenticated -> authenticated, token_expired)
- Log per-stock scoring state (DEBUG level -- too verbose for INFO)

**Acceptance Criteria:**
- `grep 'state_change' ~/.stark/logs/stark-*.jsonl` shows full workflow progression
- Duration between states is captured
- Auth failures logged with clear next-step message

### Step 5: `stark logs` Command

**Location:** `packages/cli/src/commands/logs.ts`

- `stark logs --errors` -- filter to ERROR level only
- `stark logs --run <runId>` -- filter to specific workflow run
- `stark logs --today` -- display today's application log (formatted for terminal)
- Output: formatted, colored terminal output (timestamp | level | component | message)

> **Deferred to Phase 2+:** `--grep` (users have `grep`/`jq`), `--scoring` (users can `cat` the scoring JSONL directly). Only implement features that `grep` cannot do easily: parsing JSONL and formatting for terminal display.

**Acceptance Criteria:**
- `--errors` and `--run` filter flags work correctly
- `--today` displays formatted log output
- Output is human-readable (not raw JSON)
- Handles missing log files gracefully ("No logs for today")

---

## Log Retention Strategy

| Log Type | Format | Rotation | Retention | Location |
|----------|--------|----------|-----------|----------|
| Application Log | JSONL | Daily | 14 days | `~/.stark/logs/stark-YYYY-MM-DD.jsonl` |
| Scoring Log | JSONL | Daily | 28 days (longer -- audit trail) | `~/.stark/logs/scoring-YYYY-MM-DD.jsonl` |
| Console | Formatted text | None (ephemeral) | Current session | stderr |

**Disk budget:** At ~1000 entries/day, each log file is ~200-500KB. 14 days = ~7MB. 28 days of scoring logs = ~14MB. Total: <25MB. Negligible.

**Cleanup trigger:** `logger.rotateLogs()` runs at every CLI command startup. Deletes files exceeding retention. No cron needed.

---

## Debugging Playbook (Reference)

### "A score looks wrong"
1. `stark logs --run <runId> | grep <SYMBOL>` -- see all events for that stock in that run
2. `stark logs --scoring | grep <SYMBOL>` -- see factor-level detail
3. Check `data` field for input values that fed the factor calculation

### "An API is failing"
1. `stark logs --errors` -- see recent errors
2. `stark logs --today | grep 'api.'` -- see all API events
3. Look for `fallback_triggered` events -- shows which fallback level was reached
4. `stark status` -- see API call counts (are we hitting rate limits?)

### "The workflow hung or crashed"
1. `stark logs --today | grep 'state_change'` -- see how far it got
2. Last state_change shows where it stopped
3. Check for ERROR entries near that timestamp

### "Scores are stale / data is old"
1. `stark logs --today | grep 'cache'` -- see cache hit/miss ratio
2. Look for WARN entries about stale data fallback
3. `stark status` -- shows cache freshness

---

## Success Criteria (Overall)

1. **Any error traceable in <2 minutes:** Find error -> get runId -> see full context -> identify root cause
2. **Zero overhead:** Logging adds <50ms total to a 2-minute workflow
3. **Self-maintaining:** Log rotation automatic, no manual cleanup ever needed
4. **Consistent format:** Application log and Scoring Log both JSONL with shared `runId`
5. **Solo-dev friendly:** <1 day to implement, `grep`/`jq` to query, no special tools

---

## ADR: Logging System Architecture Decision

**Decision:** Custom JSONL logger (~120 lines) writing to daily-rotated files, with colored console output on stderr.

**Drivers:**
1. Bun compatibility (must work reliably on Bun runtime)
2. Solo developer -- minimal maintenance burden
3. Integration with existing Scoring Log and ScoringContext patterns
4. Debuggability for a CLI tool that runs in short bursts (2-5 minutes)

**Alternatives Considered:**
- **Pino:** Rejected due to Bun compatibility risk (sonic-boom async writer relies on Node.js stream internals) and over-engineering for the use case
- **Expand Scoring Log:** Rejected because mixing general events into a factor-specific audit log corrupts both purposes

**Why Custom Logger:**
- Zero dependencies = zero Bun compatibility risk
- JSONL format matches existing Scoring Log (team of one, one format to learn)
- ~120 lines of code is less than the config needed for pino + pino-pretty + pino-roll
- Full control over console formatting, rotation, and integration points

**Consequences:**
- Must manually implement rotation (trivial: date-based file naming + delete old)
- No child logger context inheritance (manually pass component name -- acceptable for <10 call sites)
- No async buffering (acceptable: <1000 writes per session, sync is fine)

**Follow-ups:**
- If Stark grows to a long-running server (Phase 3+ web app), re-evaluate async writes
- If log volume grows significantly, consider adding `--since` and `--until` time filters to `stark logs`
- Consider adding a `stark logs --export` command for sharing debug info if others ever use Stark
