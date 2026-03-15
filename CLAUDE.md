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

Bun + TypeScript monorepo with two packages:

- **`@stark/core`** (`packages/core/`) — Pure TypeScript library. Zero runtime dependencies beyond Bun built-ins (`bun:sqlite`, `fetch`).
- **`@stark/cli`** (`packages/cli/`) — CLI application. Depends on `@stark/core`.

Cross-package imports use path aliases: `@stark/core/scoring/engine.js`, `@stark/cli/commands/score.js`. All imports use `.js` extensions (ESM).

### Scoring Engine

13-factor scoring system: 8 algorithmic + 5 semi-discretionary (LLM-enhanced).

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

`MockProvider` is used as fallback when broker auth fails, providing synthetic data for development.

## Workflow Rules

- **Test-first bug fixes**: When asked to fix an issue, first write tests that reproduce the issue (failing tests), then fix the code until all tests pass.
- **Always use worktrees**: Start all work in a new git worktree under `.claude/worktrees/` within the project directory. Never create worktrees outside the project root. Commit only to the worktree branch — do not merge to master without explicit user approval.

## Key Conventions

- **Config**: `~/.stark/config.json` loaded by `loadConfig()`. All fields optional. `StarkConfig.llm?: LLMConfig` controls LLM (opt-in).
- **Auth**: `SessionManager` handles Angel One TOTP login. Session cached in `~/.stark/session.json` (valid for 1 day).
- **Tests**: Use `bun:test` (`describe`/`it`/`expect`/`mock`). In-memory SQLite for DB tests. Mock `globalThis.fetch` for API tests.
- **No npm API SDKs**: All external APIs (Anthropic, Gemini, Perplexity, Angel One) use direct HTTP fetch.
- 3 pre-existing test failures with `vi.setSystemTime` are resolved — use `bun:test`'s `setSystemTime` instead of vitest's.
