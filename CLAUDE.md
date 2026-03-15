<!-- CC-PROJECT-FRAMEWORK-INTEGRATED -->

## 🔴 MANDATORY: Read Before Any Work

Before starting ANY task, you MUST:

1. Read `docs/PLAN.md` — the current strategic plan and scope
2. Read `docs/STATUS.md` — what's done, in progress, and blocked
3. Read `docs/DECISIONS.md` — why things changed (if it exists)
4. Read any spec files in `docs/specs/` — SDD artifacts live here

If any of these files don't exist, create them.

## 🔵 Status Reporting (AUTOMATIC — DO THIS ALWAYS)

After completing any meaningful unit of work (feature, fix, task, subtask), you MUST
update `docs/STATUS.md` by appending an entry in this format:

```
### [YYYY-MM-DD HH:MM] — {{summary}}
- **Type**: feature | fix | refactor | research | planning
- **Status**: completed | in-progress | blocked
- **Files changed**: list of key files
- **What was done**: 1-2 sentence description
- **What's next**: 1-2 sentence description of immediate next step
- **Blockers**: none | description of what's blocking
```

This is NON-NEGOTIABLE. The project dashboard depends on this file being current.

## 🟡 Plan Hierarchy (IMPORTANT)

```
docs/PLAN.md              ← STRATEGIC (master, human-updated)
  │                          Project direction, scope, phases, milestones.
  │
  └── .omc/plans/*        ← TACTICAL (per-feature, OMC-created)
                             Implementation plans for specific features/tasks.
```

Rules:
- ALWAYS read `docs/PLAN.md` first to understand project direction
- NEVER contradict `docs/PLAN.md` in an OMC tactical plan — if conflict, PLAN.md wins
- If the user gives a strategic change (scope, pivot, dropped feature), update `docs/PLAN.md`
- `docs/PLAN.md` feeds the cross-project dashboard. `.omc/plans/` do not.

## 🟠 Plan Change Protocol

When new information arrives that changes the plan:

1. Update `docs/PLAN.md` with the new plan
2. Add an entry to `docs/DECISIONS.md` explaining what/why/impact
3. Update `docs/STATUS.md` to reflect any tasks now invalid/blocked
4. If tasks are in progress that conflict with the new plan, STOP and flag in STATUS.md

<!-- END CC-PROJECT-FRAMEWORK -->
# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Test Commands

```bash
# Run all tests (from /mnt/c/Projects/SteveTrading — NTFS required for bun:sqlite)
cd /mnt/c/Projects/SteveTrading && bun test packages/core/tests/

# Run a single test file
cd /mnt/c/Projects/SteveTrading && bun test packages/core/tests/db.test.ts

# Type checking
bun run typecheck          # or: bunx tsc --noEmit

# Lint
bun run lint

# Run the CLI
bun run packages/cli/bin/stark.ts --help
```

**Critical**: Source lives on `/mnt/d/` (exFAT, git repo) but tests must run from `/mnt/c/` (NTFS) because `bun:sqlite` requires NTFS file locking. After editing files on `/mnt/d/`, copy changed files to `/mnt/c/` before running tests.

## Architecture

Bun + TypeScript monorepo with three packages:

- **`@stark/core`** (`packages/core/`) — Pure TypeScript library. Zero runtime dependencies beyond Bun built-ins (`bun:sqlite`, `fetch`).
- **`@stark/cli`** (`packages/cli/`) — CLI application. Depends on `@stark/core`.
- **`@stark/telegram`** (`packages/telegram/`) — Telegram bot interface. Depends on `@stark/core` and `@stark/cli`.

Cross-package imports use path aliases: `@stark/core/scoring/engine.js`, `@stark/cli/commands/score.js`. All imports use `.js` extensions (ESM).

### Scoring Engine

13-factor scoring system: 7 algorithmic + 6 semi-discretionary (LLM-enhanced). Batch scoring always produces `PARTIAL` status; `COMPLETE` only after human review of all semi-discretionary factors.

- **Registry** (`scoring/registry.ts`): Defines factors with `FactorFunction` signature, each returning `FactorOutput` (score 0/0.5/1, reasoning, dataSource).
- **Engine** (`scoring/engine.ts`): Orchestrates scoring. Takes `DataProvider`, `DatabaseAdapter`, optional `LLMService`. Produces `ScoreResult` with per-factor breakdown.
- **Factors** (`scoring/factors/`): Each factor is a standalone function. LLM factors have algorithmic pre-filter + optional LLM for borderline cases. All factors work without LLM (graceful degradation).

### LLM Integration

Optional, opt-in via `~/.stark/config.json`. Provider priority: Claude (primary) > Gemini (fallback). Perplexity is independent (financial research).

- **`LLMService` interface**: `analyzeOHLCV()`, `research()`, `canAnalyze()`, `canResearch()`, `getAnalysisProvider()`
- **`LLMServiceImpl`**: Creates clients based on config keys. Runtime fallback cascade (Claude fails -> Gemini if available).
- **`llmService: LLMService | null`**: Always nullable. Factors check `if (llmService)` before using.
- All API calls use direct `fetch()` — no SDK dependencies.

### Database

`bun:sqlite` with `DatabaseAdapter` interface. Data stored in `~/.stark/stark.db`.

- **Migrations**: Array of SQL strings in `db/schema.ts`, applied by `runMigrations()`.
- **Queries**: Abstracted in `db/queries.ts` via `Queries` class.
- **Tables**: watchlists, watchlist_stocks, ohlcv_cache, stock_scores, llm_cache, mbi_daily, trade_journal, positions.

### CLI Commands

Entry point: `packages/cli/bin/stark.ts`. Commands are lazy-imported functions matching pattern:

```typescript
export async function fooCommand(args: string[]): Promise<void> { ... }
```

**`CommandContext`** (`cli/utils/command-context.ts`): Shared bootstrap for commands needing auth + data. Loads config, creates DB, auto-authenticates with Angel One, optionally creates LLM service, builds ScoringEngine.

### Data Flow

Angel One broker API -> `DataProvider` interface -> OHLCV cache (SQLite) -> Scoring factors -> Score results (SQLite + CLI output).

Auth fails closed — broker auth failure throws, never silently degrades. `MockProvider` is only available when `STARK_MOCK=1` is explicitly set (with loud console warnings). Do NOT use mock data for live trading decisions.

## Workflow Rules

- **Test-first bug fixes**: When asked to fix an issue, first write tests that reproduce the issue (failing tests), then fix the code until all tests pass.
- **Always use worktrees**: Start all work in a new git worktree under `.claude/worktrees/` within the project directory. Never create worktrees outside the project root. Commit only to the worktree branch — do not merge to master without explicit user approval.

## Key Conventions

- **Config**: `~/.stark/config.json` loaded by `loadConfig()`. All fields optional. `StarkConfig.llm?: LLMConfig` controls LLM (opt-in).
- **Auth**: `SessionManager` handles Angel One TOTP login. Session cached in `~/.stark/session.json` (valid for 1 day).
- **Tests**: Use `bun:test` (`describe`/`it`/`expect`/`mock`). In-memory SQLite for DB tests. Mock `globalThis.fetch` for API tests.
- **No npm API SDKs**: All external APIs (Anthropic, Gemini, Perplexity, Angel One) use direct HTTP fetch.
