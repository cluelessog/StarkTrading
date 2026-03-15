# PRD: Sprint 2 — Logging System

**Created:** 2026-03-12
**Execution plan:** `plan-logging-intraday-worktrees.md` Part 1
**Worktree:** `feat/logging-system`
**Baseline:** 172 tests pass, 3 pre-existing failures

---

## Problem Statement

Stark CLI has no structured logging. Debugging requires re-running commands and reading console output. There's no way to correlate events across a scoring run, filter errors from past runs, or control verbosity levels. The existing `Logger` class writes basic JSONL but lacks `runId` correlation, component tagging, and CLI integration.

## Goals

- Enhanced Logger with `runId`, `component`, `event` fields and `child()` method
- `--verbose`/`--quiet` CLI flags with `LOG_LEVEL` env support
- ScoringContext `session_id` wired to logger `runId`
- State transition logging in evening/morning/review workflows
- `stark logs` command for filtering log entries
- Replace existing `logger.test.ts` with `bun:test` + new API

## Non-Goals

- Migrating existing `console.log()` calls to Logger (conscious dual-output model)
- Wiring Logger into core library modules (e.g., `session-manager.ts`)
- SQLite-backed log storage
- npm logging library dependencies

## Technical Constraints

- Logger init MUST be placed AFTER `--help`/`--version` early exits in `stark.ts`
- `-v` stays as `--version` shorthand; verbose is `--verbose` only (no `-v` conflict)
- Console output goes to `process.stderr.write()` (not stdout)
- JSONL files written via `appendFileSync` to `~/.stark/logs/`
- Replace `logger.test.ts` (vitest → bun:test + new 4-arg API) in same commit as Logger refactor

## Acceptance Criteria

### Step 1: Logger Core Enhancement
- [ ] `Logger` has 4-arg methods: `info(component, event, msg, data?)`
- [ ] `Logger.init({ consoleLevel })` sets runtime config
- [ ] `Logger.setRunId(id)` attaches runId to all subsequent entries
- [ ] `Logger.getRunId()` returns current runId
- [ ] `LogEntry` has fields: `ts`, `level`, `runId`, `component`, `event`, `msg`, `data`
- [ ] Console output goes to stderr, not stdout
- [ ] JSONL file output includes all LogEntry fields
- [ ] `generateRunId()` produces `YYYYMMDD-HHmmss-XXXX` format

### Step 2: ComponentLogger via child()
- [ ] `logger.child('scoring')` returns a ComponentLogger with fixed component prefix
- [ ] ComponentLogger methods delegate to parent Logger with component pre-filled
- [ ] Multiple children can exist simultaneously

### Step 3: CLI Flags + Logger Init
- [ ] `--verbose` sets console level to DEBUG
- [ ] `--quiet` sets console level to ERROR
- [ ] `LOG_LEVEL` env var overrides flags
- [ ] Default console level is INFO (file always captures DEBUG+)
- [ ] Logger init placed AFTER `--help`/`--version` early exits
- [ ] `rotateLogs(14)` runs only for actual commands, not `--help`/`--version`
- [ ] `logs` command registered in COMMANDS array and switch statement

### Step 4: ScoringContext Integration
- [ ] `createScoringContext(symbols, sessionId?)` accepts optional sessionId
- [ ] `scoreBatch(symbols, runId?)` passes runId to createScoringContext
- [ ] `evening.ts` passes `logger.getRunId()` to `scoreBatch()`
- [ ] `batch_summary` event logged after scoring with timing, errors, cache stats

### Step 5: State Transition Logging
- [ ] `evening.ts` logs: `workflow_start`, `mbi_fetch`, `scoring_start`, `scoring_complete`, `focus_list`, `workflow_complete`
- [ ] `morning.ts` logs: `workflow_start`, `mbi_refresh`, `quotes_fetch`, `workflow_complete`
- [ ] `review.ts` logs: `review_start`, `override`, `review_complete`

### Step 6: `stark logs` Command
- [ ] `stark logs` shows recent log entries (last 50)
- [ ] `stark logs --errors` filters to ERROR/WARN only
- [ ] `stark logs --run <id>` filters by runId
- [ ] `stark logs --today` filters to today's entries
- [ ] Reads JSONL files from `~/.stark/logs/`

### Step 7: Tests
- [ ] `logger.test.ts` REPLACED with bun:test + new 4-arg API tests
- [ ] Tests verify: init, setRunId, child(), log levels, file output, stderr output, rotation
- [ ] `logs-command.test.ts` tests JSONL parsing and filtering

### Global
- [ ] All existing 172 tests still pass (logger.test.ts updated, not broken)
- [ ] ~17 new tests pass (~189 total)
- [ ] `bun run typecheck` passes
- [ ] One commit per step (8 commits total)

## Verification Commands

```bash
cd /mnt/c/SteveTrading-logging && bun test                    # ~189 pass, 3 pre-existing fail
cd /mnt/d/Projects/SteveTrading-logging && bun run typecheck   # zero errors
```
