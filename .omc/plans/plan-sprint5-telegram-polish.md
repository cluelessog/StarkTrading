# Sprint 5: Telegram Bot Polish -- Entry/Exit Wiring, Analytics, Bug Fixes

**Date:** 2026-03-15 (RALPLAN iteration 2 -- revised per Architect + Critic feedback)
**Baseline:** Sprint 4 complete on master (Telegram bot, scheduler, portfolio sync, notifications)
**Branch:** `feat/sprint5-telegram-polish`
**Estimated complexity:** MEDIUM (~600-800 new/modified lines, ~30 tests)
**Scope:** 1-2 weeks

---

## RALPLAN-DR Summary

### Principles

1. **Fix before extending** -- Wire the entry/exit stubs and fix portfolio-sync catch before adding new metrics.
2. **Pure functions for analytics** -- Follow `generatePerformanceReport(db)` and `generateEvolutionReport(db)` pattern. New analytics are standalone functions in `journal/`.
3. **No new packages or infrastructure** -- All changes live in existing `@stark/core` and `packages/telegram/`.
4. **Test-first for bug fixes** -- Failing test first, then fix. New features get co-located tests.
5. **Graceful degradation** -- Analytics functions return sensible defaults when insufficient data (following `sufficientData` pattern).

### Decision Drivers (Top 3)

1. **Entry/exit stubs block daily use** -- Telegram bot cannot log trades, which is the core journaling workflow.
2. **Portfolio-sync silent error swallowing** -- Unexpected errors are counted as "already synced" instead of surfaced.
3. **Performance analytics gap** -- Win rate exists but no drawdown, streak, or risk-adjusted metrics.

### Viable Options

#### Option A: 4-phase incremental (CHOSEN)

Wire entry/exit + fix bugs first (Phase 1), add analytics (Phase 2), add Telegram performance tool (Phase 3), cleanup (Phase 4). Each phase is independently mergeable.

**Pros:** Each phase delivers value; Phase 1 alone fixes the most critical gap; analytics build on verified entry/exit wiring.
**Cons:** 4 phases means 4 verification cycles.

#### Option B: Single large phase

All changes in one commit/phase.

**Why rejected:** Entry/exit wiring must be verified before analytics can be meaningfully tested with real data. Bugs should be fixed and verified before layering features on top. Atomicity reduces rollback blast radius.

### ADR

- **Decision:** Option A -- 4-phase incremental delivery
- **Drivers:** Entry/exit is critical-path; analytics depend on working trade logging; bug fixes should not be bundled with features
- **Alternatives considered:** Single phase (rejected: no verification gates between dependencies)
- **Consequences:** 4 commits; each phase has its own smoke test; Phase 4 can be deferred if Phase 1 takes longer
- **Follow-ups:** Future sprint can add equity curve visualization, Sharpe ratio with risk-free rate, and per-sector analytics

---

## Phase 1: Entry/Exit Wiring + Bug Fixes

**Objective:** Make Telegram entry/exit commands functional (DB writes via TradeManager), add NLU patterns, fix portfolio-sync error handling, clean up cron-start dynamic import.

### 1A. NLU Regex Patterns for Entry/Exit

**File:** `packages/telegram/src/nlu.ts`
**Location:** Inside `exactMatch()` method, after line 103 (before `return null`)

Add two regex patterns:

```
entry SYMBOL PRICE SHARES [STOP]
exit SYMBOL PRICE [REASON]
```

**Exact patterns to add:**

```typescript
// entry SYMBOL PRICE SHARES [STOP]
const entryMatch = t.match(/^entry\s+([A-Za-z0-9_-]+)\s+(\d+(?:\.\d+)?)\s+(\d+)(?:\s+(\d+(?:\.\d+)?))?$/i);
if (entryMatch) {
  const symbol = entryMatch[1].toUpperCase();
  this.lastSymbolByChat.set(chatId, symbol);
  return {
    command: 'entry',
    args: {
      symbol,
      price: entryMatch[2],
      shares: entryMatch[3],
      ...(entryMatch[4] ? { stop: entryMatch[4] } : {}),
    },
    confidence: 1,
  };
}

// exit SYMBOL PRICE [REASON]
const exitMatch = t.match(/^exit\s+([A-Za-z0-9_-]+)\s+(\d+(?:\.\d+)?)(?:\s+(stopped|target|discretion|invalidated))?$/i);
if (exitMatch) {
  const symbol = exitMatch[1].toUpperCase();
  this.lastSymbolByChat.set(chatId, symbol);
  return {
    command: 'exit',
    args: {
      symbol,
      price: exitMatch[2],
      ...(exitMatch[3] ? { reason: exitMatch[3].toUpperCase() } : {}),
    },
    confidence: 1,
  };
}
```

### 1B. Entry/Exit Executor Wiring

**File:** `packages/telegram/src/executor.ts`
**Location:** Replace the `entry` tool registration (lines 200-214) and `exit` tool registration (lines 216-225)

**Construction:** Create `TradeManager` from `ctx.db` at the top of `createToolRegistry()`:

```typescript
import { TradeManager } from '@stark/core/journal/trade-manager.js';

export function createToolRegistry(ctx: PersistentCommandContext): ToolRegistry {
  const registry = new ToolRegistry();
  const tradeManager = new TradeManager(ctx.db);
  // ... existing tools ...
```

**Entry tool replacement -- validation logic (extracted from CLI `entry.ts:38-56`):**

```typescript
registry.register({
  name: 'entry',
  description: 'Log a trade entry',
  examples: ['entry RELIANCE 2500 100 2450'],
  async execute(args) {
    const symbol = (args.symbol ?? '').toUpperCase();
    if (!symbol) return { data: null, summary: 'Usage: entry SYMBOL PRICE SHARES [STOP]' };

    const entryPrice = parseFloat(args.price ?? '');
    const shares = parseInt(args.shares ?? '', 10);
    const stopStr = args.stop;

    if (isNaN(entryPrice) || isNaN(shares)) {
      return { data: null, summary: 'Error: price and shares must be valid numbers' };
    }

    let stopPrice: number | undefined;
    if (stopStr) {
      stopPrice = parseFloat(stopStr);
      if (isNaN(stopPrice)) {
        return { data: null, summary: 'Error: stop price must be a valid number' };
      }
      if (stopPrice >= entryPrice) {
        return { data: null, summary: 'Error: stop price must be below entry price' };
      }
    }

    // Default conviction to MEDIUM (CLI equivalent: --conviction flag with MEDIUM default)
    const conviction = (args.conviction ?? 'MEDIUM').toUpperCase() as 'HIGH' | 'MEDIUM' | 'LOW';
    const validConvictions = ['HIGH', 'MEDIUM', 'LOW'];
    if (!validConvictions.includes(conviction)) {
      return { data: null, summary: 'Error: conviction must be HIGH, MEDIUM, or LOW' };
    }

    try {
      const result = tradeManager.entry({ symbol, entryPrice, shares, stopPrice, conviction });
      const lines = [
        `Trade entered: ${result.symbol}`,
        `  Entry: Rs ${result.entryPrice}`,
        `  Shares: ${result.shares}`,
        result.stopPrice != null ? `  Stop: Rs ${result.stopPrice}` : '  Stop: not set',
        result.riskAmount != null ? `  Risk: Rs ${result.riskAmount}` : null,
        `  Conviction: ${result.conviction}`,
        result.scoreAtEntry != null ? `  Score: ${result.scoreAtEntry}` : null,
        result.regime ? `  Regime: ${result.regime}` : null,
        `  Trade ID: ${result.tradeId}`,
      ].filter(Boolean);
      return { data: result, summary: lines.join('\n') };
    } catch (err) {
      return { data: null, summary: `Error: ${(err as Error).message}` };
    }
  },
});
```

**Exit tool replacement:**

```typescript
registry.register({
  name: 'exit',
  description: 'Log a trade exit',
  examples: ['exit RELIANCE 2600', 'exit RELIANCE 2600 target'],
  async execute(args) {
    const symbol = (args.symbol ?? '').toUpperCase();
    const exitPrice = parseFloat(args.price ?? '');
    if (!symbol || isNaN(exitPrice)) {
      return { data: null, summary: 'Usage: exit SYMBOL PRICE [REASON]' };
    }

    const reasonStr = (args.reason ?? 'DISCRETION').toUpperCase();
    const validReasons = ['STOPPED', 'TARGET', 'DISCRETION', 'INVALIDATED'];
    if (!validReasons.includes(reasonStr)) {
      return { data: null, summary: `Error: reason must be one of: ${validReasons.join(', ')}` };
    }

    try {
      const result = tradeManager.exit({
        symbol,
        exitPrice,
        exitReason: reasonStr as 'STOPPED' | 'TARGET' | 'DISCRETION' | 'INVALIDATED',
      });
      const pnlSign = result.pnl >= 0 ? '+' : '';
      const rSign = result.rMultiple >= 0 ? '+' : '';
      const lines = [
        `Trade closed: ${result.symbol}`,
        `  Entry: Rs ${result.entryPrice}`,
        `  Exit: Rs ${result.exitPrice}`,
        `  P&L: ${pnlSign}Rs ${result.pnl}`,
        `  R: ${rSign}${result.rMultiple}R`,
        `  Hold: ${result.holdDays} days`,
        `  Reason: ${result.exitReason}`,
      ];
      return { data: result, summary: lines.join('\n') };
    } catch (err) {
      return { data: null, summary: `Error: ${(err as Error).message}` };
    }
  },
});
```

### 1C. Portfolio-Sync Discriminating Catch

**File:** `packages/core/src/journal/portfolio-sync.ts`
**Location:** Lines 48-50 (the catch block in the new-positions loop)

**Current (buggy):**
```typescript
} catch (err) {
  result.alreadySynced++;
}
```

**Replacement:**
```typescript
} catch (err) {
  const msg = (err as Error).message ?? '';
  if (msg.includes('Already have open trade')) {
    result.alreadySynced++;
  } else {
    result.warnings.push(`${pos.symbol}: unexpected error during sync entry — ${msg}`);
  }
}
```

### 1D. Cron-Start Dynamic Import Cleanup (style, low severity)

**File:** `packages/cli/src/commands/cron-start.ts`
**Location:** Line 85

**Current:**
```typescript
const currentRegime = mbiResult
  ? (await import('@stark/core/mbi/regime-classifier.js')).classifyRegimeFull(mbiResult.mbi).regime
  : null;
```

**Replacement:** Add static import at top of file:
```typescript
import { classifyRegimeFull } from '@stark/core/mbi/regime-classifier.js';
```
Then replace line 85:
```typescript
const currentRegime = mbiResult
  ? classifyRegimeFull(mbiResult.mbi).regime
  : null;
```

### Phase 1 Tests (~12 tests)

**File:** `packages/telegram/tests/nlu-entry-exit.test.ts` (new, ~60 lines)
- `entry RELIANCE 2500 100 2450` -> `{ command: 'entry', args: { symbol: 'RELIANCE', price: '2500', shares: '100', stop: '2450' } }`
- `entry INFY 1500 50` -> `{ command: 'entry', args: { symbol: 'INFY', price: '1500', shares: '50' } }` (no stop)
- `exit RELIANCE 2600` -> `{ command: 'exit', args: { symbol: 'RELIANCE', price: '2600' } }` (default reason)
- `exit RELIANCE 2600 target` -> `{ command: 'exit', args: { symbol: 'RELIANCE', price: '2600', reason: 'TARGET' } }`
- `entry` with no args -> no match (returns null from exactMatch)
- Case insensitive: `Entry RELIANCE 2500 100` works

**File:** `packages/telegram/tests/executor-entry-exit.test.ts` (new, ~80 lines)
- Entry with valid args -> calls TradeManager.entry(), returns formatted summary
- Entry with NaN price -> returns error summary
- Entry with stop >= price -> returns error summary
- Entry for already-open symbol -> returns error from TradeManager
- Exit with valid args -> calls TradeManager.exit(), returns P&L summary
- Exit for non-open symbol -> returns error from TradeManager

**File:** `packages/core/tests/portfolio-sync.test.ts` (extend existing)
- Sync with unexpected error -> pushes to warnings (not alreadySynced)
- Sync with "Already have open trade" error -> increments alreadySynced

### Phase 1 Verification

```bash
# NLU tests
cd /mnt/c/Projects/SteveTrading && bun test packages/telegram/tests/nlu-entry-exit.test.ts

# Executor entry/exit tests
cd /mnt/c/Projects/SteveTrading && bun test packages/telegram/tests/executor-entry-exit.test.ts

# Portfolio sync tests
cd /mnt/c/Projects/SteveTrading && bun test packages/core/tests/portfolio-sync.test.ts

# Full regression
cd /mnt/c/Projects/SteveTrading && bun test

# Type check
bun run typecheck
```

**Acceptance Criteria:**
- [ ] `entry RELIANCE 2500 100 2450` via Telegram creates a trade in DB
- [ ] `exit RELIANCE 2600 target` via Telegram closes the trade with P&L
- [ ] Entry with invalid numbers returns user-friendly error (not a crash)
- [ ] Default conviction is MEDIUM when not specified
- [ ] Default exit reason is DISCRETION when not specified
- [ ] Portfolio-sync unexpected errors appear in warnings array
- [ ] Portfolio-sync "Already have open trade" errors increment alreadySynced
- [ ] cron-start uses static import for classifyRegimeFull
- [ ] All existing tests pass
- [ ] ~12 new tests pass

---

## Phase 2: Advanced Performance Analytics

**Objective:** Add drawdown, streak, profit factor, and risk-adjusted metrics to `journal/performance.ts`. Pure functions following the `generatePerformanceReport(db)` pattern.

### New Interface: `AdvancedPerformanceStats`

**File:** `packages/core/src/journal/performance.ts`

```typescript
export interface AdvancedPerformanceStats {
  maxDrawdown: DrawdownResult;
  currentStreak: StreakResult;
  longestWinStreak: number;
  longestLoseStreak: number;
  profitFactor: number;
  avgWinToAvgLoss: number;
  calmarRatio: number | null;  // null when maxDrawdown is 0
  kellyPct: number;
}

export interface DrawdownResult {
  /** Peak-to-trough percentage on cumulative PnL of closed trades sorted by exit date */
  maxDrawdownPct: number;
  /** Absolute max drawdown in Rs */
  maxDrawdownAbs: number;
  /** Index (0-based) in sorted-by-exitDate closed trades where peak occurred */
  peakTradeIndex: number;
  /** Index where trough occurred */
  troughTradeIndex: number;
}

export interface StreakResult {
  /** 'W' for winning streak, 'L' for losing streak, null if no closed trades */
  type: 'W' | 'L' | null;
  /** Number of consecutive same-result trades at end of closed-trade sequence */
  length: number;
}
```

### Metric Definitions (mathematical)

1. **Max Drawdown** -- Sort closed trades by `exitDate` ASC. Compute cumulative PnL series: `cumulativePnl[i] = sum(pnl[0..i])`. Track running peak. Drawdown at each point = `(peak - cumulativePnl[i]) / peak * 100`. Max drawdown = largest such drawdown. When peak is 0 or negative, use absolute drawdown (Rs) only.

2. **Current Streak** -- Sort closed trades by `exitDate` ASC. Walk backwards from the last trade. Count consecutive wins (`pnl > 0`) or losses (`pnl <= 0`). Return type (W/L) and length.

3. **Longest Win/Lose Streak** -- Walk all closed trades sorted by `exitDate` ASC. Track current streak type and length. Record max of each type.

4. **Profit Factor** -- `sum(pnl where pnl > 0) / abs(sum(pnl where pnl <= 0))`. Returns `Infinity` if no losses (use `Number.POSITIVE_INFINITY`). Returns `0` if no wins.

5. **Avg Win / Avg Loss Ratio** -- `avgWin / avgLoss`. Reuse values from existing `PerformanceStats`. Returns `0` if avgLoss is 0.

6. **Calmar Ratio** -- `totalPnl / maxDrawdownAbs`. Returns `null` when maxDrawdownAbs is 0.

7. **Kelly Percentage** -- `winRate - ((1 - winRate) / (avgWin / avgLoss))`. Clamped to [0, 100]. Represents optimal bet size as percentage.

### New Function

**File:** `packages/core/src/journal/performance.ts`

```typescript
export function generateAdvancedStats(db: DatabaseAdapter): AdvancedPerformanceStats {
  // Pure function: takes db, returns stats
  // Uses Queries internally (same pattern as generatePerformanceReport)
  // Returns defaults when insufficient data (<2 closed trades)
}
```

**Default return (insufficient data):**
```typescript
{
  maxDrawdown: { maxDrawdownPct: 0, maxDrawdownAbs: 0, peakTradeIndex: 0, troughTradeIndex: 0 },
  currentStreak: { type: null, length: 0 },
  longestWinStreak: 0,
  longestLoseStreak: 0,
  profitFactor: 0,
  avgWinToAvgLoss: 0,
  calmarRatio: null,
  kellyPct: 0,
}
```

### Phase 2 Tests (~10 tests)

**File:** `packages/core/tests/advanced-performance.test.ts` (new, ~120 lines)

Setup: In-memory SQLite with `TradeManager` to insert test trades (same pattern as existing `performance.test.ts`).

- Max drawdown with 5 trades (3 wins, 2 losses): verify peak/trough indices and percentage
- Max drawdown with all wins: returns 0
- Max drawdown with all losses: returns correct cumulative loss
- Current streak: 3 consecutive wins at end -> `{ type: 'W', length: 3 }`
- Current streak: 2 consecutive losses at end -> `{ type: 'L', length: 2 }`
- Longest streaks: verify across mixed sequence
- Profit factor with positive and negative trades
- Profit factor with no losses -> `Infinity`
- Kelly percentage: known values with 60% win rate, 2:1 ratio -> 40%
- Insufficient data (<2 trades): returns defaults

### Phase 2 Verification

```bash
cd /mnt/c/Projects/SteveTrading && bun test packages/core/tests/advanced-performance.test.ts
cd /mnt/c/Projects/SteveTrading && bun test
bun run typecheck
```

**Acceptance Criteria:**
- [ ] `generateAdvancedStats(db)` is a pure function in `journal/performance.ts`
- [ ] Max drawdown correctly computes peak-to-trough on cumulative PnL sorted by exit date
- [ ] Current streak counts consecutive wins/losses from the end of trade history
- [ ] Profit factor handles edge cases (no wins, no losses)
- [ ] Kelly percentage is clamped to [0, 100]
- [ ] Calmar ratio returns null when max drawdown is 0
- [ ] Insufficient data returns sensible defaults (not NaN or errors)
- [ ] ~10 new tests pass
- [ ] All existing tests pass

---

## Phase 3: Telegram Performance Tool Enhancement

**Objective:** Wire `generateAdvancedStats()` into the Telegram `performance` tool so users see advanced metrics alongside basic stats.

### Changes

**File:** `packages/telegram/src/executor.ts`
**Location:** Replace the existing `performance` tool registration (lines 161-175)

```typescript
import { generatePerformanceReport } from '@stark/core/journal/performance.js';
import { generateAdvancedStats } from '@stark/core/journal/performance.js';

registry.register({
  name: 'performance',
  description: 'Show trading performance metrics',
  examples: ['performance', 'stats', 'my performance'],
  async execute(_args) {
    const report = generatePerformanceReport(ctx.db);
    const advanced = generateAdvancedStats(ctx.db);
    const o = report.overall;

    if (o.closedTrades === 0) {
      return { data: null, summary: 'No closed trades yet. Log entries and exits to see performance.' };
    }

    const lines = [
      `Performance (${o.closedTrades} closed trades):`,
      `  Win rate: ${o.winRate}%`,
      `  Avg R: ${o.avgRMultiple}R`,
      `  Total PnL: Rs ${o.totalPnl.toLocaleString('en-IN')}`,
      `  Expectancy: Rs ${o.expectancy}`,
      `  Profit factor: ${advanced.profitFactor === Infinity ? 'Perfect (no losses)' : advanced.profitFactor.toFixed(2)}`,
      `  Max drawdown: ${advanced.maxDrawdown.maxDrawdownAbs > 0 ? `Rs ${advanced.maxDrawdown.maxDrawdownAbs.toLocaleString('en-IN')} (${advanced.maxDrawdown.maxDrawdownPct.toFixed(1)}%)` : 'None'}`,
      `  Current streak: ${advanced.currentStreak.type ? `${advanced.currentStreak.length}${advanced.currentStreak.type}` : 'N/A'}`,
      `  Best streak: ${advanced.longestWinStreak}W / Worst: ${advanced.longestLoseStreak}L`,
      `  Kelly: ${advanced.kellyPct.toFixed(1)}%`,
      `  Avg hold: ${o.avgHoldDays} days`,
      o.sufficientData ? '' : `  (Need ${o.minTradesNeeded} more trades for reliable stats)`,
    ].filter(Boolean);

    return { data: { report, advanced }, summary: lines.join('\n') };
  },
});
```

### Phase 3 Tests (~4 tests)

**File:** `packages/telegram/tests/executor-performance.test.ts` (new, ~40 lines)

- Performance with 0 closed trades -> "No closed trades" message
- Performance with trades -> summary includes profit factor, drawdown, streak
- Performance summary format contains expected fields

### Phase 3 Verification

```bash
cd /mnt/c/Projects/SteveTrading && bun test packages/telegram/tests/executor-performance.test.ts
cd /mnt/c/Projects/SteveTrading && bun test
bun run typecheck
```

**Acceptance Criteria:**
- [ ] `performance` command via Telegram shows advanced metrics
- [ ] Empty state returns helpful message (not an error)
- [ ] Profit factor shows "Perfect (no losses)" for Infinity case
- [ ] ~4 new tests pass
- [ ] All existing tests pass

---

## Phase 4: Polish and Cleanup (DEFERRABLE if Phase 1 takes longer)

**Objective:** Minor quality improvements. Can be deferred to a future sprint without blocking daily use.

### 4A. Export `AdvancedPerformanceStats` from Core Barrel

**File:** `packages/core/src/journal/index.ts` (or wherever journal barrel exports live)

Ensure `generateAdvancedStats`, `AdvancedPerformanceStats`, `DrawdownResult`, `StreakResult` are exported.

### 4B. Add `conviction` Default to NLU Entry Pattern

Currently the NLU entry pattern does not capture conviction. This is correct since the regex `entry SYMBOL PRICE SHARES [STOP]` does not include it. Add an extended pattern variant:

**File:** `packages/telegram/src/nlu.ts`

```typescript
// entry SYMBOL PRICE SHARES STOP CONVICTION (full form)
const entryFullMatch = t.match(/^entry\s+([A-Za-z0-9_-]+)\s+(\d+(?:\.\d+)?)\s+(\d+)\s+(\d+(?:\.\d+)?)\s+(high|medium|low)$/i);
```

This is additive -- does not change the 4-arg pattern from Phase 1.

### 4C. Update Help Tool with Entry/Exit Usage

**File:** `packages/telegram/src/executor.ts`
**Location:** The `help` tool

Ensure the entry/exit tools show correct usage examples in the help output (already handled by ToolRegistry's `getToolDescriptions()` using each tool's `examples` array -- verify the new examples are accurate).

### Phase 4 Tests (~4 tests)

**File:** `packages/telegram/tests/nlu-entry-exit.test.ts` (extend)
- `entry RELIANCE 2500 100 2450 high` -> conviction: 'HIGH'
- `entry RELIANCE 2500 100 2450 LOW` -> conviction: 'LOW'

### Phase 4 Verification

```bash
cd /mnt/c/Projects/SteveTrading && bun test
bun run typecheck
```

**Acceptance Criteria:**
- [ ] Advanced stats types exported from core barrel
- [ ] Full entry pattern with conviction works
- [ ] Help command shows entry/exit usage
- [ ] All tests pass

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| TradeManager construction fails without proper DB setup | LOW | Phase 1 blocked | TradeManager only needs `DatabaseAdapter`; `ctx.db` is already initialized in PersistentCommandContext |
| Entry validation edge cases (negative numbers, zero shares) | MEDIUM | Bad data in journal | Validation mirrors CLI `entry.ts` which handles these cases; test coverage for edge cases |
| Max drawdown calculation with negative cumulative PnL at start | MEDIUM | Incorrect drawdown % | Use absolute drawdown (Rs) as primary; percentage only when peak > 0 |
| Existing executor tests may mock the entry/exit tools | LOW | Test breakage | Check and update any existing mocks to match new signatures |
| Portfolio-sync test isolation (shared DB state) | LOW | Flaky tests | Use fresh in-memory SQLite per test (existing pattern) |
| Phase 1 takes longer than expected (NLU + executor + bug fix) | MEDIUM | Phases 3-4 deferred | Phase 4 is explicitly deferrable; Phase 2 analytics are independent of Phase 1 bugs |

---

## Contingency

If Phase 1 takes longer than expected due to test complexity or unexpected issues:
- **Phase 2** can proceed in parallel (analytics are independent pure functions)
- **Phase 4** is deferred to a future sprint (it is polish, not critical functionality)
- **Phase 3** depends on Phase 2 but is small (~40 lines) and can be merged with Phase 2

---

## File Summary

| Phase | New Files | Modified Files | Est. Lines |
|-------|-----------|----------------|------------|
| 1 | 2 (test files) | 4 (`nlu.ts`, `executor.ts`, `portfolio-sync.ts`, `cron-start.ts`) | ~250 |
| 2 | 1 (test file) | 1 (`performance.ts`) | ~220 |
| 3 | 1 (test file) | 1 (`executor.ts`) | ~80 |
| 4 | 0 | 3 (`index.ts`, `nlu.ts`, `executor.ts`) | ~40 |
| **Total** | **4** | **9 (some overlap)** | **~590** |

**Total new tests:** ~30

---

## Success Criteria (Sprint 5 Definition of Done)

1. `entry RELIANCE 2500 100 2450` via Telegram creates a real trade in the database
2. `exit RELIANCE 2600 target` via Telegram closes the trade with correct P&L and R-multiple
3. `performance` via Telegram shows drawdown, streaks, profit factor, and Kelly %
4. Portfolio-sync surfaces unexpected errors as warnings (not silent swallowing)
5. cron-start uses static import for classifyRegimeFull
6. All existing tests pass unchanged (zero regressions)
7. ~30 new tests pass
8. `bun run typecheck` passes
