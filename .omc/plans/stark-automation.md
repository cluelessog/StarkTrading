# Plan: Stark-Trading Full Automation Pipeline (v2 - Revised)

**Date:** 2026-03-07
**Status:** REVISED - Incorporating Architect + Critic feedback
**Complexity:** MEDIUM-HIGH (reduced from HIGH after simplification)
**Scope:** ~12-15 new/modified files across `packages/core` and `packages/cli`

---

## RALPLAN-DR Summary

### Principles

1. **Trigger-driven over manual** -- The daemon responds to triggers (file detection, scheduled times) and runs pipeline stages as direct function calls. No event bus indirection.
2. **Graceful degradation** -- Every automated step must handle auth failure, network errors, and missing data without crashing the daemon.
3. **Existing seams first** -- Build on the existing `DataProvider` interface, `Queries` class, `ScoringEngine`, and `loadConfig()` rather than introducing new abstractions.
4. **Observable automation** -- Every automated action must be logged and produce audit-trail entries in the DB so the user can review what happened while away.
5. **Platform-aware** -- The daemon runs as a foreground process (user manages via tmux/screen/nohup). File watching uses polling (fs.watch is broken on WSL2 9P mounts).

### Decision Drivers (Top 3)

1. **TOTP constraint** -- Angel One requires daily TOTP auth. Auto-generating TOTP from a stored seed is the only path to fully unattended operation.
2. **TradingView export path** -- The user exports CSVs from TradingView manually. A polling file watcher on the export directory eliminates the `stark import` manual step.
3. **Time-sensitive workflow** -- Evening scoring must complete after market close; morning checks must run before 9:15 AM IST. Scheduling must be timezone-aware and holiday-aware.

### Viable Options

#### Option A: Bun-native daemon with direct function pipeline (CHOSEN)

A long-running `stark daemon` foreground process with a polling file watcher, trading-day-aware scheduler, and direct async function chain for the pipeline.

**Pros:**
- Single process, full access to core library in-process
- Single `stark daemon start` UX -- no cron configuration needed
- Direct function calls are simpler to debug than event chains
- Polling watcher works reliably on all filesystems (WSL2 9P, exFAT, NTFS)

**Cons:**
- Must run in tmux/screen/nohup (no true fork-detach in Bun)
- If daemon crashes, user must restart manually (no auto-recovery in v1)

#### Option B: OS-level cron + stateless CLI invocations (REJECTED)

**Why rejected:** Cannot chain import -> score -> focus -> notify without IPC. More installation friction (crontab setup, Bun PATH in cron's limited shell). Separate systems to configure and debug.

#### Option C: Hybrid cron + trigger script (CONSIDERED)

**Why not chosen:** While simpler, the user explicitly asked for `stark import` to "auto import" and commands to "perform auto operations" -- a single daemon command better matches this expectation than scattered cron entries. The simplified daemon (direct functions, polling, foreground) captures the hybrid's simplicity while preserving the single-command UX.

---

## ADR: Stark Automation Architecture

**Decision:** Implement a Bun-native foreground daemon (`stark daemon`) with polling file watcher, direct async function pipeline, TOTP auto-auth, and OS notifications.

**Drivers:** TOTP daily auth constraint, sequential pipeline need, WSL2 platform constraints.

**Alternatives considered:**
- OS cron (rejected: IPC complexity, installation friction)
- Hybrid cron + scripts (rejected: UX mismatch with user's expectation of auto-operations)
- Event bus architecture (rejected per Architect review: over-engineering for a strictly sequential pipeline)

**Consequences:**
- User runs daemon in tmux/screen (documented in AUTOMATION.md)
- TOTP seed stored in config.json with chmod 600 file permissions
- Polling interval configurable (default 30s) -- slightly delayed detection vs. real-time
- No crash auto-recovery in v1 (acceptable for personal tool)

---

## Context

Stark-Trading currently requires the user to manually run CLI commands in sequence: `stark auth` -> `stark import <csv>` -> `stark evening` (score + focus) -> `stark morning` (gap check).

This plan adds a `stark daemon` command that automates the full pipeline:
1. Auto-authenticates with Angel One using a stored TOTP seed
2. Polls a directory for new TradingView CSV exports and auto-imports them
3. Runs the evening scoring workflow on a schedule (or triggered by import)
4. Runs the morning gap-check workflow on a schedule
5. Sends OS notifications for key events

---

## Guardrails

### Must Have
- TOTP auto-generation from stored seed with daily session refresh
- Polling file watcher on configurable watch directory
- Direct pipeline: file detected -> import -> score -> focus list -> notify
- Scheduled morning workflow (8:45 AM IST on trading days)
- Scheduled evening workflow (4:00 PM IST on trading days, skipped if import already triggered it)
- OS notifications via `notify-send` (Linux) / PowerShell toast (WSL)
- `stark daemon start|stop|status|logs` commands
- SQLite busy_timeout for concurrent CLI + daemon access
- Config file permissions (chmod 600) for credential security
- Automation event log table in SQLite for audit trail
- All automation respects trading calendar (skip weekends + NSE holidays)

### Must NOT Have
- Order placement or trade execution (out of scope per PRD)
- Event bus / EventEmitter (over-engineering for sequential pipeline)
- True fork-detach daemonization (Bun lacks process.fork)
- Encrypted TOTP seed storage (v2 stretch goal)
- Web UI or dashboard (CLI-only)
- Breaking changes to existing CLI commands

---

## Task Flow

```
[1. Config + TOTP Auth + busy_timeout] --> [2. Scheduler + automation_log]
                                                     |
                                                     v
                              [3. Polling Watcher + importCSV refactor]
                                                     |
                                                     v
                              [4. Pipeline + Daemon lifecycle]
                                                     |
                                                     v
                              [5. Notifications + daemon CLI]
                                                     |
                                                     v
                              [6. Testing + AUTOMATION.md]
```

---

## Detailed TODOs

### Step 1: Config Extension + TOTP Auto-Auth + DB Fix

**Files to create/modify:**
- `packages/core/src/config/index.ts` -- extend `AngelOneConfig` and `StarkConfig`
- `packages/core/src/auth/totp.ts` -- NEW: TOTP generation from seed
- `packages/core/src/auth/session-manager.ts` -- NEW: auto-auth + session refresh
- `packages/core/src/auth/index.ts` -- NEW: barrel export
- `packages/core/src/db/adapter.ts` -- add `PRAGMA busy_timeout = 5000`
- `packages/core/tests/totp.test.ts` -- NEW

**Work:**
1. Add fields to `AngelOneConfig`: `totpSeed?: string`, `clientCode?: string`, `password?: string`
2. Add `AutomationConfig` to `StarkConfig`:
   ```typescript
   automation?: {
     watchDir: string;          // default: ~/Downloads
     watchPattern: string;      // default: *.csv
     pollIntervalMs: number;    // default: 30000
     schedules: { morning: string; evening: string }; // default: "08:45", "16:00"
     notifications: { enabled: boolean };
   }
   ```
3. Implement RFC 6238 TOTP generation (HMAC-SHA1, 6-digit, 30-second window) using Bun's crypto APIs
4. Implement `SessionManager` class:
   - `ensureAuthenticated(): Promise<boolean>` -- checks `isAuthenticated()`, auto-authenticates if expired
   - Uses `AngelOneProvider.authenticate()` with auto-generated TOTP
   - Logs auth events to automation_log
5. Add `PRAGMA busy_timeout = 5000` after WAL pragma in `BunSQLiteAdapter` constructor (adapter.ts line 29)
6. In `getStarkDir()` or `saveConfig()`: set file permissions to 0o600 on config.json (`chmodSync`)
7. At daemon startup: warn if config.json is world-readable

**Acceptance Criteria:**
- [ ] `generateTOTP(seed, time)` produces correct 6-digit codes (verified against RFC 6238 test vectors)
- [ ] `SessionManager.ensureAuthenticated()` returns true after successful auto-auth
- [ ] `SessionManager.ensureAuthenticated()` returns true immediately when session is valid (no re-auth)
- [ ] Config loads with new optional fields without breaking existing configs
- [ ] `PRAGMA busy_timeout` is set -- concurrent `stark entry` during daemon run does not get SQLITE_BUSY
- [ ] config.json is created with mode 0o600

---

### Step 2: Trading Scheduler + DB Migration

**Files to create/modify:**
- `packages/core/src/scheduler/scheduler.ts` -- NEW: trading-day-aware scheduler
- `packages/core/src/scheduler/index.ts` -- NEW: barrel export
- `packages/core/src/db/schema.ts` -- add `automation_log` table
- `packages/core/src/db/migrations.ts` -- add migration v2
- `packages/core/src/db/queries.ts` -- add automation log query methods
- `packages/core/tests/scheduler.test.ts` -- NEW

**Work:**
1. Create `TradingScheduler` class:
   - Takes schedule config (morning time, evening time) and trading calendar
   - Uses `setTimeout` chain to schedule next execution
   - Calls provided callbacks directly (no event bus)
   - Skips weekends and NSE holidays using existing `isTradingDay()` + `nextTradingDay()`
   - Tracks last run time to prevent duplicate runs
2. Add migration v2: `automation_log` table:
   - Columns: `id INTEGER PRIMARY KEY`, `timestamp TEXT`, `event_type TEXT`, `payload TEXT`, `status TEXT`, `error_message TEXT`
3. Add `Queries` methods: `insertAutomationLog(...)`, `getAutomationLogs(since: string, limit: number)`

**Acceptance Criteria:**
- [ ] Scheduler calls morning callback at configured time on trading days
- [ ] Scheduler calls evening callback at configured time on trading days
- [ ] Scheduler skips weekends and NSE holidays, schedules for next valid trading day
- [ ] `automation_log` table created by migration v2 without breaking existing v1 databases
- [ ] `insertAutomationLog()` and `getAutomationLogs()` work correctly

---

### Step 3: Polling File Watcher + Import Refactor

**Files to create/modify:**
- `packages/core/src/watcher/file-watcher.ts` -- NEW: polling directory watcher
- `packages/core/src/watcher/index.ts` -- NEW: barrel export
- `packages/cli/src/commands/import-cmd.ts` -- refactor: extract `importCSV()`
- `packages/core/tests/file-watcher.test.ts` -- NEW

**Work:**
1. Create `PollingWatcher` class:
   - Polls configured `watchDir` at `pollIntervalMs` interval
   - Tracks seen files by filename + mtime to avoid re-processing
   - Calls provided callback with file path when new CSV detected
   - Gracefully handles: directory not existing, permission errors, empty directory
2. Refactor `importCommand`:
   - Extract `importCSV(csvPath: string, queries: Queries, config: StarkConfig): Promise<ImportResult>`
   - `ImportResult` includes: `{ symbolCount: number, unmappedCount: number, watchlistId: number, watchlistName: string }`
   - The function accepts `queries` as a parameter (shared DB connection from daemon)
   - CLI command becomes a thin wrapper that creates DB, calls `importCSV()`, prints results

**Acceptance Criteria:**
- [ ] `PollingWatcher` detects new `.csv` files in watch directory
- [ ] Already-processed files (same name + mtime) are not re-imported
- [ ] `importCSV()` is callable programmatically with structured input (no CLI args dependency)
- [ ] `importCSV()` accepts `queries` parameter (uses shared DB connection)
- [ ] Existing `stark import <csv>` CLI command continues to work unchanged

---

### Step 4: Pipeline + Daemon Lifecycle

**Files to create/modify:**
- `packages/core/src/daemon/pipeline.ts` -- NEW: direct async function pipeline
- `packages/core/src/daemon/daemon.ts` -- NEW: daemon lifecycle (foreground process)
- `packages/core/src/daemon/index.ts` -- NEW: barrel export

**Work:**
1. Create `Pipeline` class with direct async methods:
   ```typescript
   class Pipeline {
     async runImportPipeline(csvPath: string): Promise<void> {
       await this.sessionManager.ensureAuthenticated();
       const result = await importCSV(csvPath, this.queries, this.config);
       await this.runScoring(result.watchlistId);
       await this.runFocusList();
       this.notifier.notify('Focus list ready', `${result.symbolCount} stocks imported and scored`);
     }
     async runEvening(): Promise<void> { /* auth + score + focus + notify */ }
     async runMorning(): Promise<void> { /* auth + gap check + notify */ }
   }
   ```
   - Each method wrapped in try/catch, errors logged to `automation_log`
   - Deduplication: tracks last scoring session to avoid re-scoring
2. Create `Daemon` class:
   - `start()`: init config, DB, watcher, scheduler, pipeline; write PID to `~/.stark/daemon.pid`; register SIGINT/SIGTERM handlers
   - Runs as **foreground process** (no fork-detach)
   - `stop()`: reads PID file, sends SIGTERM
   - `status()`: reads PID file, checks if process alive via `kill -0`
   - Heartbeat: touches `~/.stark/daemon.heartbeat` every 60s for stale detection

**Acceptance Criteria:**
- [ ] CSV file in watch dir triggers full pipeline: import -> score -> focus list -> notify
- [ ] Evening schedule triggers auth + full evening workflow
- [ ] Morning schedule triggers auth + morning gap check
- [ ] Auth failures are logged to automation_log but daemon continues running
- [ ] PID file written on start, removed on graceful stop
- [ ] SIGINT/SIGTERM trigger graceful shutdown
- [ ] Duplicate scoring prevented when both import and schedule trigger in same session

---

### Step 5: OS Notifications + Daemon CLI Command

**Files to create/modify:**
- `packages/core/src/notifications/notifier.ts` -- NEW: cross-platform notifications
- `packages/core/src/notifications/index.ts` -- NEW: barrel export
- `packages/cli/src/commands/daemon.ts` -- NEW: `stark daemon start|stop|status|logs`
- `packages/cli/bin/stark.ts` -- replace `cron` with `daemon` in COMMANDS + switch

**Work:**
1. Create `Notifier` class:
   - `notify(title: string, body: string, urgency?: 'low' | 'normal' | 'critical'): void`
   - Linux: spawns `notify-send` with `--urgency` flag
   - WSL2: detects `/mnt/c/Windows`, uses PowerShell toast
   - Fallback: appends to `~/.stark/notifications.log`
   - Respects `config.automation.notifications.enabled`
2. Wire notifications to pipeline:
   - Focus list ready -> notify
   - Morning gap alert -> notify (critical)
   - Auth failed -> notify (critical)
   - Pipeline error -> notify
3. Implement `stark daemon` CLI:
   - `stark daemon start` -- runs daemon in foreground (prints "Use tmux/screen to run in background")
   - `stark daemon stop` -- sends SIGTERM to PID from PID file
   - `stark daemon status` -- checks PID + heartbeat freshness
   - `stark daemon logs [--tail N]` -- queries automation_log, displays recent events
4. Replace `cron` with `daemon` in stark.ts COMMANDS list and switch

**Acceptance Criteria:**
- [ ] `notify-send` called on Linux with correct title/body/urgency
- [ ] WSL2 detected and PowerShell toast used
- [ ] Notifications suppressed when `config.automation.notifications.enabled` is false
- [ ] `stark daemon start` runs daemon in foreground with clear output
- [ ] `stark daemon stop` gracefully shuts down running daemon
- [ ] `stark daemon status` reports running/stopped + last heartbeat age
- [ ] `stark daemon logs` shows recent automation events from DB

---

### Step 6: Integration Testing + Documentation

**Files to create/modify:**
- `packages/core/tests/daemon-pipeline.test.ts` -- NEW
- `packages/core/tests/session-manager.test.ts` -- NEW
- `packages/core/tests/notifier.test.ts` -- NEW
- `docs/AUTOMATION.md` -- NEW

**Work:**
1. Pipeline integration test: mock watcher triggers -> verify import -> scoring -> focus list -> notification
2. Scheduler tests with fake timers: trading day, weekend skip, holiday skip
3. SessionManager tests: mock Angel One API for auth success/failure/refresh
4. Notifier tests: verify command construction for Linux and WSL2
5. Write `AUTOMATION.md`:
   - Prerequisites (Angel One account, TOTP seed)
   - Config setup (adding credentials, watch directory, schedules)
   - Security notes (chmod 600, what's stored where)
   - Starting the daemon (`tmux new -s stark` -> `stark daemon start`)
   - Monitoring (`stark daemon status`, `stark daemon logs`)
   - Stopping (`stark daemon stop` or Ctrl+C)
   - Troubleshooting (auth failures, watch directory issues)

**Acceptance Criteria:**
- [ ] Full pipeline integration test passes with mocked providers
- [ ] Scheduler test covers: trading day, weekend skip, holiday skip, end-of-week rollover
- [ ] SessionManager test covers: fresh auth, cached session, expired re-auth, auth failure
- [ ] All existing 104+ tests continue to pass (no regressions)
- [ ] `AUTOMATION.md` documents setup from zero to running daemon

---

## Success Criteria

1. User adds TOTP seed to config, sets watch directory, runs `stark daemon start` in tmux -- daemon runs unattended
2. Dropping a CSV into the watch directory triggers the full pipeline within 60 seconds
3. Evening workflow runs automatically at configured time on trading days
4. Morning gap check runs automatically at configured time on trading days
5. Auth is auto-refreshed daily without user intervention
6. User receives OS notification when focus list is generated or gap alerts detected
7. `stark daemon logs` shows complete audit trail of all automated actions
8. All existing CLI commands work concurrently with the daemon (no SQLITE_BUSY errors)
9. config.json is secured with 0o600 permissions

---

## Changes from v1 (Architect + Critic feedback incorporated)

| v1 (Original) | v2 (Revised) | Reason |
|---|---|---|
| Event bus with 8 event types | Direct async function chain | Sequential pipeline doesn't need indirection |
| fs.watch with polling fallback | Polling-only | fs.watch broken on WSL2 9P mounts |
| Fork-detach daemon | Foreground process (tmux/screen) | Bun lacks process.fork() |
| No busy_timeout | PRAGMA busy_timeout = 5000 | Prevent SQLITE_BUSY with concurrent CLI |
| TOTP security deferred | chmod 600 + startup warning | Compound credential exposure needs v1 mitigation |
| importCSV creates own DB | importCSV accepts queries param | Shared DB connection from daemon |
| Principle: "Event-driven over polling" | Principle: "Trigger-driven over manual" | Reflects actual architecture honestly |
