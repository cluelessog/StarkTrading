# Stark-Trading Intelligent Automation Plan

**Date:** 2026-03-07
**Complexity:** HIGH
**Scope:** ~25 new files, ~12 modified files across packages/core and packages/cli

---

## RALPLAN-DR Summary

### Principles

1. **Self-Sufficiency First** -- Every command must auto-fetch data, auto-authenticate, and handle errors gracefully. No manual data piping.
2. **Additive Extension** -- New LLM factors plug into the existing FactorRegistry and ScoringEngine without modifying their core interfaces. The `FactorInput` / `FactorOutput` / `RegisteredFactor` contracts remain stable.
3. **Graceful Degradation** -- If LLM APIs are unavailable, disabled, or over budget, commands still work with algorithmic-only scores (status remains PARTIAL). If auth fails, MockProvider is used with a clear warning.
4. **Cost Awareness** -- LLM and Perplexity calls are cached aggressively (existing `llm_cache` table + `LLMConfig.cacheTtlHours`). Batch requests where possible. Never call LLM for the same OHLCV data twice in a session.
5. **Zero Regression** -- All 104+ existing tests continue to pass. New features get new test files. The `ScoringEngine` signature does not break.

### Decision Drivers (Top 3)

1. **Factor Registry is the seam** -- The existing `FactorRegistry` already distinguishes `algorithmic`, `semi-discretionary`, and `discretionary` types, and `ScoringEngine.scoreSymbol()` already iterates `getAlgorithmic()`. Changing the 5 discretionary factors to `semi-discretionary` with LLM-backed `fn` implementations is the minimal-change path.
2. **Auth is the bottleneck** -- Every command currently has copy-pasted auth boilerplate (check config, try AngelOne, fall back to Mock). A `SessionManager` that auto-generates TOTP and transparently authenticates eliminates this duplication and is prerequisite for all self-sufficient commands.
3. **ScoringEngine already supports PARTIAL/COMPLETE** -- The DB schema has columns for all 13 factors. The `review` command manually fills discretionary columns. LLM factors simply fill those same columns automatically, changing status from PARTIAL to COMPLETE.

### Viable Options

#### Option A: LLM-as-Factor (Recommended)

Convert 5 discretionary factors to `semi-discretionary` with LLM `fn` implementations. ScoringEngine automatically evaluates them alongside algorithmic factors. `review` command becomes optional override.

- **Pros:** Minimal engine changes; factors are independently testable; caching is per-factor; graceful fallback (factor returns score 0 if LLM unavailable).
- **Cons:** 5 separate LLM calls per stock (mitigated by batching prompt into single Gemini call for all 5).

#### Option B: Separate LLM Scoring Pass

Keep factors as `discretionary`, add a new `LLMReviewEngine` that runs after `ScoringEngine` and fills discretionary columns automatically.

- **Pros:** Zero changes to existing factor registry types.
- **Cons:** Two-pass scoring adds complexity; harder to test; creates a second scoring path that must stay synchronized; `ScoringEngine` still returns PARTIAL, requiring a second step to promote to COMPLETE.
- **Invalidation rationale:** This option adds unnecessary architectural complexity. The existing registry already supports `semi-discretionary` type and `fn` fields on every factor. Option A uses the architecture as designed.

### ADR

- **Decision:** Option A -- LLM-as-Factor
- **Drivers:** Registry already supports it, single scoring pass, independently testable factors
- **Alternatives considered:** Option B (separate LLM pass) -- rejected due to two-pass complexity and architectural duplication
- **Why chosen:** Minimal structural change, factors are composable and independently mockable, graceful degradation is built-in (fn returns 0 on failure)
- **Consequences:** LLM calls happen inside `ScoringEngine.scoreSymbol()`, so scoring becomes async-heavier and slower (mitigated by caching). The `review` command shifts from "required step" to "optional override".
- **Follow-ups:** Future factors (e.g., LLM-enhanced pattern quality) follow the same pattern. Perplexity EP catalyst enhancement follows the same `FactorInput` -> `FactorOutput` contract.

---

## Context

Stark-Trading is a Bun + TypeScript monorepo CLI for Indian stock market (NSE) momentum trading. The current MVP requires manual data input for 5 of 13 scoring factors and manual authentication. The goal is to make every command self-sufficient: auto-auth, auto-fetch data, auto-score all 13 factors using LLMs where needed, and auto-research catalysts via Perplexity.

### Current State
- **8 algorithmic factors** implemented in `packages/core/src/scoring/factors/`
- **5 discretionary factors** registered in registry with `fn: null`, filled manually via `stark review`
- **Auth** requires manual `stark auth --totp=<totp>` before every session
- **Import** requires CSV file path
- **All commands** have copy-pasted auth boilerplate (try AngelOne, fall back to Mock)
- **Scores** are always `PARTIAL` until manual review
- **LLM infrastructure** exists in config (`LLMConfig`) and DB (`llm_cache` table) but is not wired up
- **104+ tests** pass in vitest

---

## Work Objectives

Transform Stark-Trading from a manual-input CLI into a self-sufficient intelligent trading assistant where every command auto-authenticates, auto-fetches data, and produces complete 13-factor scores using LLM analysis.

---

## Guardrails

### Must Have
- All 104+ existing tests continue to pass
- LLM features respect `config.llm.enabled` flag (disabled by default)
- LLM responses cached per `llm_cache` table with TTL from config
- All commands work without LLM (graceful degradation to PARTIAL scores)
- Angel One rate limiter respected for all data fetching
- No order execution -- this is a manual trading assistant

### Must NOT Have
- No breaking changes to `DataProvider`, `FactorRegistry`, `FactorInput`/`FactorOutput` interfaces
- No removal of MockProvider or mock data fallback
- No hardcoded API keys -- all keys from config
- No new npm/bun dependencies beyond Gemini SDK and Perplexity API client (or raw fetch)
- No changes to DB schema version 1 (use existing columns and tables)

---

## Task Flow

```
Step 1: LLM Service Layer + SessionManager
  |
  v
Step 2: 5 New LLM-Assessed Scoring Factors
  |
  v
Step 3: Enhanced EP Catalyst (Perplexity) + Pattern Quality (LLM)
  |
  v
Step 4: ScoringEngine Integration (PARTIAL -> COMPLETE)
  |
  v
Step 5: Self-Sufficient Commands (auto-auth, auto-fetch, smart import)
  |
  v
Step 6: Verification + Integration Testing
```

---

## Detailed TODOs

### Step 1: LLM Service Layer + SessionManager

**Objective:** Build the foundational infrastructure that all subsequent steps depend on.

**Files to create:**
- `packages/core/src/llm/llm-service.ts` -- Unified LLM interface
- `packages/core/src/llm/gemini-client.ts` -- Gemini API client (OHLCV analysis)
- `packages/core/src/llm/perplexity-client.ts` -- Perplexity API client (research/news)
- `packages/core/src/llm/llm-cache.ts` -- Cache layer using existing `llm_cache` DB table
- `packages/core/src/llm/index.ts` -- Barrel export
- `packages/core/src/auth/session-manager.ts` -- Auto-TOTP generation + transparent auth
- `packages/core/src/auth/index.ts` -- Barrel export
- `packages/core/tests/llm-service.test.ts` -- Tests with mocked HTTP
- `packages/core/tests/session-manager.test.ts` -- Tests for auto-auth flow

**Key interfaces:**
```typescript
// llm-service.ts
interface LLMService {
  analyzeOHLCV(prompt: string, bars: OHLCVBar[], config: LLMConfig): Promise<LLMAnalysisResult>;
  research(query: string, config: LLMConfig): Promise<ResearchResult>;
  isEnabled(config: LLMConfig): boolean;
}

interface LLMAnalysisResult {
  score: number;        // 0 or 1 (or 0.5 for graduated)
  reasoning: string;
  confidence: number;   // 0-1
  cached: boolean;
}

// session-manager.ts
interface SessionManager {
  ensureAuthenticated(provider: DataProvider, config: StarkConfig): Promise<DataProvider>;
  // Returns authenticated AngelOneProvider or MockProvider with warning
}
```

**Implementation notes:**
- `gemini-client.ts`: Use `fetch()` to call Gemini API (no SDK dependency). Send OHLCV data as structured JSON in prompt. Parse JSON response.
- `perplexity-client.ts`: Use `fetch()` to call Perplexity `chat/completions` endpoint. Use `sonar` model for research queries.
- `llm-cache.ts`: Hash prompt with `Bun.hash()` or `crypto.createHash('sha256')`. Check `llm_cache` table before API call. Respect `cacheTtlHours`. TTL check query (no schema changes needed): `SELECT * FROM llm_cache WHERE prompt_hash = ? AND datetime(created_at, '+' || ? || ' hours') > datetime('now')` passing `cacheTtlHours` as the second parameter. If no matching row, treat as cache miss.
- `session-manager.ts`: Read TOTP secret from `~/.stark/config.json` (`angelOne.totpSecret`). Generate TOTP using RFC 6238 (30-second window, SHA1, 6 digits). Call `provider.authenticate()` transparently. Add `totpSecret` to `AngelOneConfig` interface in `packages/core/src/config/index.ts` (NOT `models/config.ts` — that file has a separate inline type `StarkModelConfig`).

**Acceptance criteria:**
- [ ] `LLMService` can send OHLCV data to Gemini and parse a scored response
- [ ] `LLMService` can query Perplexity for stock research
- [ ] Responses are cached in `llm_cache` table; second call for same prompt returns cached result
- [ ] Cache respects TTL from `config.llm.cacheTtlHours`
- [ ] `SessionManager.ensureAuthenticated()` auto-generates TOTP and authenticates
- [ ] If TOTP secret is not configured, falls back to MockProvider with console warning
- [ ] If already authenticated today, skips re-auth (uses `isAuthenticated()`)
- [ ] All new code has unit tests with mocked HTTP responses
- [ ] All 104+ existing tests still pass

---

### Step 2: 5 New LLM-Assessed Scoring Factors

**Objective:** Implement the 5 previously-discretionary factors as LLM-backed scoring functions.

**Files to create:**
- `packages/core/src/scoring/factors/llm-linearity.ts`
- `packages/core/src/scoring/factors/llm-pivot-cutter.ts`
- `packages/core/src/scoring/factors/llm-aoi.ts`
- `packages/core/src/scoring/factors/llm-volume-events.ts` (HVE/HVY)
- `packages/core/src/scoring/factors/llm-volume-quality.ts` (HVQ 2.5)
- `packages/core/tests/llm-factors.test.ts`

**Note:** `pattern_quality` is already `semi-discretionary` in the registry (registry.ts:199) and is enhanced separately in Step 3. Only 5 factors change type here: `linearity`, `not_pivot_cutter`, `aoi`, `hve_hvy`, `hvq_2_5`.

**Files to modify:**
- `packages/core/src/scoring/registry.ts` -- Change 5 factors from `discretionary` to `semi-discretionary`, update `FactorInput` to include optional `llmService`
- `packages/core/src/scoring/engine.ts` -- Add 5 new factor IDs to `FACTOR_FNS` map

**Implementation approach per factor:**

1. **`llm-linearity.ts`** -- Algorithmic pre-filter + LLM confirmation
   - Calculate: standard deviation of daily returns over last 60 bars, ratio of up days to total days, smoothness metric (price path vs straight line)
   - If metrics indicate choppy/non-linear (std dev > threshold), return score 0 without LLM
   - If borderline/clean, send OHLCV summary to Gemini: "Analyze this price data for uptrend linearity. Is the trend smooth and diagonal, or choppy/staircase?"
   - Parse binary yes/no response

2. **`llm-pivot-cutter.ts`** -- Algorithmic rejection counting + LLM confirmation
   - Calculate: identify resistance level (highest high in last 20 bars), count times price approached within 1% and reversed (rejection count)
   - If rejection count >= 3, score 0 (IS a pivot cutter) without LLM
   - If rejection count 1-2, send to Gemini for nuanced assessment
   - If rejection count 0, score 1 (NOT a pivot cutter)

3. **`llm-aoi.ts`** -- Algorithmic confluence detection + LLM
   - Calculate: prior resistance levels from last 120 bars, round number proximity, check if multiple levels converge within 2%
   - Send structure summary to Gemini: "Is this stock at a significant area of interest based on the right side of its base structure?"
   - Parse binary response

4. **`llm-volume-events.ts`** (HVE/HVY) -- Purely algorithmic
   - Depends on base detection from `pivot_location` factor (same ATR compression base)
   - Base must be ≤2 months (~40 trading days). If no valid base, score 0.
   - Calculate historical volume benchmarks:
     - HVQ = highest single-day volume in last ~63 trading days (1 quarter)
     - HVY = highest single-day volume in last ~252 trading days (1 year)
     - HVE = highest single-day volume in all available history
   - Scan volume bars within the detected base:
     - If any bar's volume >= HVE level: HVE is present
     - If any bar's volume >= HVY level (but < HVE): HVY is present
   - Scoring (graduated, maxPoints: 1):
     - Both HVE and HVY present in base → score 1.0 (immediate)
     - HVE present → score 1.0
     - HVY present → score 0.5
     - Neither → score 0
   - No LLM needed -- pure data analysis

5. **`llm-volume-quality.ts`** (2.5 HVQ) -- Purely algorithmic
   - Uses same base detection and volume benchmarks as HVE/HVY factor
   - Aggregates weighted volume quality across ALL bars in the base:
     - Each bar at HVE level contributes 2.0 HVQ-equivalents
     - Each bar at HVY level contributes 1.5 HVQ-equivalents
     - Each bar at HVQ level contributes 1.0 HVQ-equivalents
   - Sum all HVQ-equivalents across the base
   - Score 0.5 (full value, maxPoints is 0.5) if aggregate >= 2.5 HVQ-equivalents, score 0 otherwise
   - No LLM needed

**FactorInput extension:**
```typescript
// Add to FactorInput (non-breaking -- optional field)
export interface FactorInput {
  symbol: string;
  token: string;
  dailyBars: OHLCVBar[];
  provider: DataProvider;
  context: ScoringContext;
  llmService?: LLMService;   // NEW: optional, null when LLM disabled
}
```

**Acceptance criteria:**
- [ ] All 5 factors implement `(input: FactorInput) => Promise<FactorOutput>` contract
- [ ] Registry updated: 5 factors changed from `discretionary` to `semi-discretionary`
- [ ] `FACTOR_FNS` map in engine.ts includes all 5 new factor IDs
- [ ] HVE/HVY and HVQ factors work without LLM (pure algorithmic)
- [ ] Linearity, pivot-cutter, AOI use LLM only when `input.llmService` is available; return score 0 with "LLM unavailable" reasoning otherwise
- [ ] Each factor has unit tests with sample OHLCV data (no actual LLM calls)
- [ ] All 104+ existing tests still pass

---

### Step 3: Enhanced EP Catalyst (Perplexity) + Pattern Quality (LLM)

**Objective:** Upgrade two existing algorithmic factors with LLM intelligence.

**Files to modify:**
- `packages/core/src/scoring/factors/ep-catalyst.ts` -- Add Perplexity research after gap detection
- `packages/core/src/scoring/factors/pattern-quality.ts` -- Add Gemini validation after algorithmic VCP detection

**Files to create:**
- `packages/core/tests/ep-catalyst-llm.test.ts`
- `packages/core/tests/pattern-quality-llm.test.ts`

**EP Catalyst enhancement:**
- Current: gap >8% detection only
- Enhanced: After gap detection (or even without gap), query Perplexity: "Has {symbol} ({company name}) had any recent earnings surprises, regulatory approvals, major contracts, or catalysts in the last 5 trading days? NSE India stock."
- If Perplexity finds a catalyst even without a gap, score 1
- If gap detected but Perplexity says it was a corporate action (split/bonus), score 0
- Fallback: if Perplexity unavailable, use existing gap-only logic

**Pattern Quality enhancement:**
- Current: algorithmic VCP heuristic (contractions + volume decline)
- Enhanced: After algorithmic detection, if score is 0.5 (partial VCP), send OHLCV data to Gemini for more nuanced assessment: "Analyze this price/volume data. Is this a valid VCP (Volatility Contraction Pattern), Inverse Head & Shoulders, or Cup & Handle? Consider contraction quality, volume behavior, and base structure."
- If Gemini confirms pattern, upgrade 0.5 to 1.0
- If Gemini rejects, keep 0.5 or downgrade to 0
- Fallback: if LLM unavailable, use existing algorithmic score

**Acceptance criteria:**
- [ ] EP Catalyst queries Perplexity when `llmService` is available
- [ ] EP Catalyst falls back to gap-only logic when Perplexity unavailable
- [ ] Perplexity results cached (same stock within `cacheTtlHours` returns cached result)
- [ ] Pattern Quality sends borderline cases to Gemini for confirmation
- [ ] Pattern Quality falls back to algorithmic-only when LLM unavailable
- [ ] Existing ep-catalyst and pattern-quality tests still pass unchanged
- [ ] New tests cover LLM-enhanced paths with mocked responses

---

### Step 4: ScoringEngine Integration (PARTIAL -> COMPLETE)

**Objective:** Wire LLM service into ScoringEngine so scoring produces COMPLETE results when LLM is enabled.

**Files to modify:**
- `packages/core/src/scoring/engine.ts` -- Accept `LLMService` in constructor, pass to `FactorInput`, update status logic
- `packages/core/src/scoring/context.ts` -- Track `llmCalls` count (field already exists)
- `packages/core/src/scoring/registry.ts` -- `getAlgorithmic()` now returns `semi-discretionary` factors too (already does this -- verify)

**Engine changes:**
```typescript
// ScoringEngine constructor gains optional llmService
constructor(
  private provider: DataProvider,
  db: DatabaseAdapter,
  registry?: FactorRegistry,
  private llmService?: LLMService,  // NEW
)

// scoreSymbol() passes llmService to FactorInput
const input: FactorInput = {
  symbol, token, dailyBars,
  provider: this.provider,
  context,
  llmService: this.llmService,  // NEW
};

// Status determination changes
// If all semi-discretionary factors have fn AND llmService is available:
//   status = 'COMPLETE', discretionaryScore is filled
// Otherwise: status = 'PARTIAL' (existing behavior)
```

**AlgorithmicScoreResult changes:**
```typescript
export interface ScoreResult {  // Renamed from AlgorithmicScoreResult
  symbol: string;
  token: string;
  factors: FactorResult[];
  algorithmicScore: number;
  discretionaryScore: number;  // NEW: from LLM factors
  totalScore: number;          // NEW: algo + discretionary
  maxPossibleScore: number;
  status: 'PARTIAL' | 'COMPLETE';  // Now can be COMPLETE
}
```

**scoreBatch() changes:**
- `insertStockScore()` call must add 5 discretionary factor params:
  ```typescript
  linearity: factorScore(result, 'linearity'),
  notPivotCutter: factorScore(result, 'not_pivot_cutter'),
  aoi: factorScore(result, 'aoi'),
  hveHvy: factorScore(result, 'hve_hvy'),
  hvq2_5: factorScore(result, 'hvq_2_5'),
  ```
  Note: `InsertStockScoreData` in `queries.ts` already accepts these fields — no `queries.ts` changes needed.
- Score computation: `discretionaryScore = sum of the 5 LLM factor scores`, `totalScore = algorithmicScore + discretionaryScore`
- Status is `COMPLETE` when all 13 factors have non-null scores, `PARTIAL` otherwise
- `scoring/index.ts` must update re-export: `AlgorithmicScoreResult` → `ScoreResult`

**Acceptance criteria:**
- [ ] `ScoringEngine` accepts optional `LLMService` in constructor
- [ ] When `LLMService` is provided and enabled, all 13 factors are scored
- [ ] When `LLMService` is null/disabled, only 8 algorithmic factors are scored (existing behavior)
- [ ] Status is `COMPLETE` when all 13 factors have scores, `PARTIAL` otherwise
- [ ] `scoreBatch()` stores all 13 factor values in DB including discretionary columns
- [ ] `context.llmCalls` is incremented for each LLM API call
- [ ] Existing `scoring-engine.test.ts` passes without modification (no LLMService = existing behavior)
- [ ] New test verifies COMPLETE scoring with mocked LLMService

---

### Step 5: Self-Sufficient Commands

**Objective:** Rewrite all CLI commands to be self-sufficient -- auto-auth, auto-fetch, no manual input required.

**Files to create:**
- `packages/core/src/api/watchlist-scraper.ts` -- Scrape stock symbols from TradingView public watchlist URLs
- `packages/cli/src/utils/command-context.ts` -- Shared command setup (auth, provider, db, llm, engine)

**Watchlist scraper implementation:**
```typescript
// watchlist-scraper.ts
interface ScrapeResult {
  symbols: string[];    // Raw symbol strings extracted
  source: string;       // URL that was scraped
  format: 'tradingview' | 'unknown';
}

async function scrapeWatchlistUrl(url: string): Promise<ScrapeResult>;
```
- Fetch the URL HTML with `fetch()` (Bun native, no dependencies)
- TradingView public watchlist pages embed symbol data in the HTML (look for `data-symbol` attributes, JSON-LD, or `<script>` blocks containing symbol arrays)
- Extract NSE-prefixed symbols (e.g., `NSE:RELIANCE` → `RELIANCE`)
- If the page is JS-rendered and symbols aren't in raw HTML, fall back to using Perplexity: "List all stock symbols in this TradingView watchlist: {url}" (LLM-assisted scraping)
- Return raw symbol list, then pipe through existing `mapSymbols()` for Angel One token resolution

**Files to modify:**
- `packages/cli/src/commands/evening.ts` -- Full auto-scoring with LLM, complete focus list
- `packages/cli/src/commands/morning.ts` -- Auto-auth, Perplexity overnight news, setup validation
- `packages/cli/src/commands/score.ts` -- `stark score RELIANCE` (positional arg), auto-fetch, all 13 factors
- `packages/cli/src/commands/import-cmd.ts` -- `stark import RELIANCE TCS` (symbol list), broker sync, CSV auto-detect
- `packages/cli/src/commands/entry.ts` -- Auto-fetch price, auto-fill score/regime/stop from latest analysis
- `packages/cli/src/commands/market.ts` -- Auto-fetch live data, LLM narrative, sector analysis
- `packages/cli/src/commands/auth.ts` -- Support `--auto` flag for TOTP auto-generation
- `packages/cli/src/commands/review.ts` -- Now optional (override-only mode)

**Shared `CommandContext`:**
```typescript
// command-context.ts
interface CommandContext {
  config: StarkConfig;
  db: DatabaseAdapter;
  queries: Queries;
  provider: DataProvider;
  llmService: LLMService | null;
  engine: ScoringEngine;
}

async function createCommandContext(): Promise<CommandContext> {
  const config = loadConfig();
  const { db, queries } = createDatabase();

  // Auto-auth
  const sessionManager = new SessionManager();
  const provider = await sessionManager.ensureAuthenticated(config);

  // LLM
  const llmService = config.llm?.enabled ? new LLMServiceImpl(config.llm, db) : null;

  // Engine
  const engine = new ScoringEngine(provider, db, undefined, llmService);

  return { config, db, queries, provider, llmService, engine };
}
```

**Command-specific changes:**

1. **`evening.ts`** -- Remove auth boilerplate (use `createCommandContext()`). Score all 13 factors. Generate COMPLETE focus list. Pre-calculate trade plans (entry price = pivot level, stop = base low, position size from risk config). Output formatted report with all scores.

2. **`morning.ts`** -- Use `createCommandContext()`. Query Perplexity for overnight news on focus stocks. Validate setups still intact (re-fetch quote, check if price gapped beyond stop). Output morning briefing.

3. **`score.ts`** -- Accept positional arg: `stark score RELIANCE` (resolve symbol via instrument master). Auto-fetch OHLCV. Score all 13 factors. Show complete breakdown.

4. **`import-cmd.ts`** -- Four modes:
   - `stark import RELIANCE TCS INFY` -- resolve symbols, add to watchlist
   - `stark import ~/Downloads/watchlist.csv` -- existing CSV flow
   - `stark import https://www.tradingview.com/watchlists/xxxxx/` -- scrape symbols from TradingView public watchlist URL
   - `stark import --broker` -- fetch positions from Angel One portfolio (future -- stub for now)
   - Auto-detect: if arg starts with `http://` or `https://`, use URL scrape mode; if args look like symbols (uppercase, no path separators), use symbol mode; otherwise treat as file path

5. **`entry.ts`** -- `stark entry RELIANCE` with minimal args. Auto-fetch current price. Look up latest score, regime, and calculated stop from focus list. Calculate position size from `config.risk.swing`. Show summary, ask for confirmation (y/n).

6. **`market.ts`** -- Auto-fetch MBI data. If LLM enabled, generate market context narrative via Gemini. Show sector flow analysis.

7. **`auth.ts`** -- Add `--auto` flag. When `config.angelOne.totpSecret` is set, auto-generate TOTP.

8. **`review.ts`** -- Change header to "Override Review (optional)". Show LLM-assessed scores. Allow overrides only. If all factors already scored (COMPLETE), show current scores and ask which to override.

**Acceptance criteria:**
- [ ] `createCommandContext()` handles auth, provider, LLM, engine setup in one call
- [ ] `stark evening` produces COMPLETE scores with all 13 factors when LLM is enabled
- [ ] `stark evening` produces PARTIAL scores (8 factors) when LLM is disabled (existing behavior preserved)
- [ ] `stark score RELIANCE` works with positional arg (no `--symbol=` needed)
- [ ] `stark import RELIANCE TCS` works with symbol list
- [ ] `stark import https://www.tradingview.com/watchlists/...` scrapes symbols from the page and imports them
- [ ] `stark morning` queries Perplexity for overnight news when available
- [ ] `stark entry RELIANCE` auto-fills price, stop, position size
- [ ] `stark market` shows LLM-generated market narrative when enabled
- [ ] `stark auth --auto` generates TOTP automatically
- [ ] All commands fall back gracefully when LLM/auth is unavailable
- [ ] No command crashes on missing config/auth -- always shows actionable error message

---

### Step 6: Verification + Integration Testing

**Objective:** Ensure everything works end-to-end, existing tests pass, new features are tested.

**Files to create:**
- `packages/core/tests/llm-integration.test.ts` -- End-to-end scoring with mocked LLM
- `packages/cli/tests/command-context.test.ts` -- CommandContext setup tests
- `packages/core/tests/session-manager-integration.test.ts` -- Auth flow tests

**Verification tasks:**
1. Run `bun run test` -- all 104+ existing tests pass
2. Run `bun run typecheck` -- zero type errors
3. Verify mock provider path: disable LLM in config, run `stark evening` -- should produce PARTIAL scores identical to current behavior
4. Verify LLM path: enable LLM with mock HTTP responses in tests, verify COMPLETE scores
5. Verify cache: run scoring twice, verify second run uses cached LLM responses
6. Verify error handling: simulate Gemini API error, verify graceful degradation to PARTIAL
7. Verify rate limiting: confirm Angel One rate limiter is used for all OHLCV fetches in batch scoring

**Acceptance criteria:**
- [ ] All existing 104+ tests pass
- [ ] All new tests pass (target: 30+ new tests across LLM, factors, session manager, commands)
- [ ] `bun run typecheck` passes with zero errors
- [ ] Mock provider path works identically to pre-change behavior
- [ ] LLM-enabled path produces COMPLETE scores
- [ ] Cache prevents duplicate LLM calls within TTL
- [ ] Error handling produces useful error messages, not stack traces
- [ ] Rate limiter prevents Angel One API abuse in batch operations

---

## Success Criteria

1. Running `stark evening` with LLM enabled produces a complete focus list with all 13 factors scored -- no manual review step needed
2. Running `stark score RELIANCE` auto-fetches data and shows all 13 factor scores
3. Running `stark import RELIANCE TCS` adds symbols to watchlist without CSV
4. Running `stark morning` shows overnight news and validates setups
5. Running `stark entry RELIANCE` auto-fills price, stop, and position size
6. All existing tests pass unchanged
7. LLM responses are cached and reused within TTL
8. All commands work without LLM (graceful degradation)
9. All commands auto-authenticate without manual TOTP entry (when totpSecret configured)

---

## File Impact Summary

### New Files (~25)
```
packages/core/src/llm/llm-service.ts
packages/core/src/llm/gemini-client.ts
packages/core/src/llm/perplexity-client.ts
packages/core/src/llm/llm-cache.ts
packages/core/src/llm/index.ts
packages/core/src/auth/session-manager.ts
packages/core/src/auth/index.ts
packages/core/src/scoring/factors/llm-linearity.ts
packages/core/src/scoring/factors/llm-pivot-cutter.ts
packages/core/src/scoring/factors/llm-aoi.ts
packages/core/src/scoring/factors/llm-volume-events.ts
packages/core/src/scoring/factors/llm-volume-quality.ts
packages/core/src/api/watchlist-scraper.ts
packages/cli/src/utils/command-context.ts
packages/core/tests/llm-service.test.ts
packages/core/tests/watchlist-scraper.test.ts
packages/core/tests/session-manager.test.ts
packages/core/tests/llm-factors.test.ts
packages/core/tests/ep-catalyst-llm.test.ts
packages/core/tests/pattern-quality-llm.test.ts
packages/core/tests/llm-integration.test.ts
packages/core/tests/session-manager-integration.test.ts
packages/cli/tests/command-context.test.ts
```

### Modified Files (~12)
```
packages/core/src/scoring/registry.ts        -- 5 factors: discretionary -> semi-discretionary, FactorInput extension
packages/core/src/scoring/engine.ts           -- LLMService in constructor, COMPLETE status logic
packages/core/src/scoring/factors/ep-catalyst.ts -- Perplexity enhancement
packages/core/src/scoring/factors/pattern-quality.ts -- Gemini validation
packages/core/src/config/index.ts             -- totpSecret in AngelOneConfig interface + defaults
packages/core/src/scoring/index.ts            -- Re-export ScoreResult (renamed from AlgorithmicScoreResult)
packages/cli/src/commands/evening.ts          -- Self-sufficient with LLM
packages/cli/src/commands/morning.ts          -- Self-sufficient with Perplexity
packages/cli/src/commands/score.ts            -- Positional arg, auto-fetch
packages/cli/src/commands/import-cmd.ts       -- Symbol list mode
packages/cli/src/commands/entry.ts            -- Auto-fill from analysis
packages/cli/src/commands/market.ts           -- LLM narrative
packages/cli/src/commands/auth.ts             -- Auto TOTP
packages/cli/src/commands/review.ts           -- Override-only mode
```

---

## Estimated Effort

| Step | Description | Effort |
|------|-------------|--------|
| 1 | LLM Service Layer + SessionManager | 2-3 days |
| 2 | 5 New LLM-Assessed Scoring Factors | 2-3 days |
| 3 | Enhanced EP Catalyst + Pattern Quality | 1-2 days |
| 4 | ScoringEngine Integration | 1 day |
| 5 | Self-Sufficient Commands | 2-3 days |
| 6 | Verification + Integration Testing | 1-2 days |
| **Total** | | **9-14 days** |

---

## Future Enhancements (Post-MVP)

### `stark scan` — Autonomous Stock Discovery

Not in current scope but planned for future versions:

1. **Intraday momentum scanner** — Monitor NSE stocks in first 15-30 minutes of market open. Detect:
   - Unusual volume surge (≥ 2x average opening volume)
   - Price momentum (gap up + continuation, breaking previous day high)
   - Sector rotation signals (multiple stocks in same sector moving together)
   - Pre-market signals from AngelOne pre-open data

2. **Swing scanner** — End-of-day scan across NSE universe:
   - RS rank > 15% vs Nifty
   - Near 52-week high with base formation
   - Volume contraction (VCP setup detection)
   - Sector strength alignment

3. **LLM-enhanced filtering** — After algorithmic scan, use Gemini to filter noise:
   - "Is this volume spike from a genuine catalyst or just a corporate action?"
   - "Does this base structure look like accumulation or distribution?"

This would shift Stark from "score my curated picks" to "find + score candidates autonomously." Requires AngelOne streaming/websocket API for real-time intraday data.

---

## Dependency Chain

```
Step 1 (LLM + Auth) --> Step 2 (LLM Factors) --> Step 4 (Engine Integration)
Step 1 (LLM + Auth) --> Step 3 (Enhanced Factors) --> Step 4 (Engine Integration)
Step 4 (Engine) --> Step 5 (Commands)
Step 5 (Commands) --> Step 6 (Verification)

Parallelizable: Steps 2 and 3 can run in parallel after Step 1.
```
