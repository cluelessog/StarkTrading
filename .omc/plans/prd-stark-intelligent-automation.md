# PRD: Stark-Trading Intelligent Automation

**Source Plan:** `.omc/plans/stark-intelligent-automation.md`
**Created:** 2026-03-07
**Status:** Ready for execution

---

## Problem Statement

Stark-Trading CLI requires manual authentication, manual CSV import, manual scoring of 5/13 factors, and manual review before producing a focus list. Every command has copy-pasted auth boilerplate. The goal is to make every command self-sufficient: auto-auth, auto-fetch, auto-score all 13 factors using LLMs, and auto-research catalysts.

## Goals

- Every CLI command works with zero manual data input
- All 13 scoring factors evaluated automatically (LLM for 5 discretionary ones)
- Auto-authentication via TOTP secret
- Import from URL, symbol list, or CSV
- Graceful degradation when LLM/auth unavailable

## Non-Goals

- No auto-trading or order execution
- No stock discovery/scanning (future enhancement)
- No new DB schema version
- No new package dependencies (use `fetch()` for APIs)

## Technical Constraints

- Bun runtime, TypeScript monorepo
- `bun:sqlite` for database
- Existing 104+ tests must pass unchanged
- `FactorInput`/`FactorOutput`/`RegisteredFactor` contracts stay stable
- LLM disabled by default (`config.llm.enabled = false`)

---

## Tasks

### Phase 1: LLM Service Layer + SessionManager

> **Dependency:** None (foundation for all other phases)

#### Task 1.1: LLM Cache Layer
**Files:** Create `packages/core/src/llm/llm-cache.ts`
**Do:**
- Implement `LLMCache` class that wraps the existing `llm_cache` DB table
- Hash prompts with `crypto.createHash('sha256')`
- `get(promptHash)`: query with TTL check: `SELECT * FROM llm_cache WHERE prompt_hash = ? AND datetime(created_at, '+' || ? || ' hours') > datetime('now')`
- `set(promptHash, response, model)`: insert into `llm_cache`
- Accept `DatabaseAdapter` and `cacheTtlHours` in constructor
**Acceptance:**
- [ ] Cache stores and retrieves LLM responses by prompt hash
- [ ] Expired entries (past TTL) return cache miss
- [ ] No DB schema changes

#### Task 1.2: Gemini Client
**Files:** Create `packages/core/src/llm/gemini-client.ts`
**Do:**
- Implement `GeminiClient` class with `analyze(prompt: string, data: unknown): Promise<LLMAnalysisResult>`
- Use `fetch()` to call Gemini API (`generativelanguage.googleapis.com`)
- Send OHLCV data as structured JSON in prompt
- Parse JSON response, extract score/reasoning/confidence
- Integrate `LLMCache` — check cache before API call, store after
- Track calls via `ScoringContext.llmCalls`
**Acceptance:**
- [ ] Can send structured prompt to Gemini and parse scored response
- [ ] Uses cache layer — second call with same prompt returns cached result
- [ ] Returns `{ score, reasoning, confidence, cached }`

#### Task 1.3: Perplexity Client
**Files:** Create `packages/core/src/llm/perplexity-client.ts`
**Do:**
- Implement `PerplexityClient` class with `research(query: string): Promise<ResearchResult>`
- Use `fetch()` to call Perplexity `chat/completions` endpoint with `sonar` model
- Integrate `LLMCache` — check cache before API call
- Parse response into `{ answer, sources, cached }`
**Acceptance:**
- [ ] Can query Perplexity for stock research
- [ ] Results cached by query hash
- [ ] Returns structured `ResearchResult`

#### Task 1.4: Unified LLM Service
**Files:** Create `packages/core/src/llm/llm-service.ts`, `packages/core/src/llm/index.ts`
**Do:**
- Define `LLMService` interface: `analyzeOHLCV()`, `research()`, `isEnabled()`
- Implement `LLMServiceImpl` that wraps `GeminiClient` + `PerplexityClient`
- Constructor takes `LLMConfig` + `DatabaseAdapter`
- `isEnabled()` checks `config.llm.enabled` and presence of API keys
- Barrel export from `index.ts`
**Acceptance:**
- [ ] `LLMService` interface is clean and mockable
- [ ] `LLMServiceImpl` delegates to Gemini/Perplexity clients
- [ ] `isEnabled()` returns false when keys missing or disabled

#### Task 1.5: Session Manager + Config Update
**Files:** Create `packages/core/src/auth/session-manager.ts`, `packages/core/src/auth/index.ts`. Modify `packages/core/src/config/index.ts`
**Do:**
- Add `totpSecret?: string` to `AngelOneConfig` interface in `config/index.ts` (NOT `models/config.ts`)
- Implement `SessionManager` class with `ensureAuthenticated(config: StarkConfig): Promise<DataProvider>`
- Generate TOTP using RFC 6238 (30-second window, SHA1, 6 digits) from `config.angelOne.totpSecret`
- Try AngelOne auth → if fails or no config, fall back to MockProvider with console warning
- If already authenticated (session valid), skip re-auth
- Barrel export from `auth/index.ts`
**Acceptance:**
- [ ] `totpSecret` added to `AngelOneConfig` interface
- [ ] TOTP generation matches RFC 6238 output
- [ ] Falls back to MockProvider with warning when no secret configured
- [ ] Skips re-auth when session is still valid

#### Task 1.6: LLM + Auth Tests
**Files:** Create `packages/core/tests/llm-service.test.ts`, `packages/core/tests/session-manager.test.ts`
**Do:**
- Test `LLMCache`: store, retrieve, TTL expiry
- Test `GeminiClient` with mocked `fetch()`: success, error, cached
- Test `PerplexityClient` with mocked `fetch()`: success, error, cached
- Test `LLMServiceImpl`: delegates correctly, respects `isEnabled()`
- Test `SessionManager`: TOTP generation, auth flow, MockProvider fallback
- Verify all 104+ existing tests still pass
**Acceptance:**
- [ ] All new tests pass
- [ ] All 104+ existing tests pass
- [ ] No actual API calls in tests (all mocked)

---

### Phase 2: LLM-Assessed Scoring Factors

> **Dependency:** Phase 1 complete

#### Task 2.1: FactorInput Extension + Registry Update
**Files:** Modify `packages/core/src/scoring/registry.ts`
**Do:**
- Add `llmService?: LLMService` optional field to `FactorInput` interface (non-breaking)
- Change 5 factors from `type: 'discretionary'` to `type: 'semi-discretionary'`: `linearity`, `not_pivot_cutter`, `aoi`, `hve_hvy`, `hvq_2_5`
- Keep their `fn: null` for now (wired in subsequent tasks)
**Acceptance:**
- [ ] `FactorInput` has optional `llmService` field
- [ ] 5 factors changed to `semi-discretionary`
- [ ] `getAlgorithmic()` returns these 5 factors (already includes semi-discretionary)
- [ ] All 104+ existing tests pass (non-breaking change)

#### Task 2.2: Volume Events Factor (HVE/HVY) — Pure Algorithmic
**Files:** Create `packages/core/src/scoring/factors/llm-volume-events.ts`
**Do:**
- Implement `volumeEvents(input: FactorInput): Promise<FactorOutput>`
- Reuse base detection from `pivot_location` (same ATR compression base, must be ≤2 months)
- Calculate historical volume benchmarks from OHLCV bars:
  - HVQ = highest single-day volume in last ~63 trading days (1 quarter)
  - HVY = highest single-day volume in last ~252 trading days (1 year)
  - HVE = highest single-day volume in all available history
- Scan volume bars within the detected base:
  - Check if any bar's volume reaches HVE level
  - Check if any bar's volume reaches HVY level
- Scoring (graduated, maxPoints: 1):
  - Both HVE and HVY present → 1.0 (immediate)
  - HVE present → 1.0
  - HVY present → 0.5
  - Neither → 0
- No LLM needed
**Acceptance:**
- [ ] Implements `FactorFunction` contract
- [ ] Uses same base detection as `pivot_location`
- [ ] Only considers volume bars within a base ≤2 months
- [ ] Correctly calculates HVQ/HVY/HVE benchmarks from history
- [ ] Scores 1.0 when HVE found, 0.5 when only HVY found

#### Task 2.3: Volume Quality Factor (2.5 HVQ) — Pure Algorithmic
**Files:** Create `packages/core/src/scoring/factors/llm-volume-quality.ts`
**Do:**
- Implement `volumeQuality(input: FactorInput): Promise<FactorOutput>`
- Uses same base detection and volume benchmarks (HVQ/HVY/HVE) as Task 2.2
- Aggregate weighted HVQ-equivalents across ALL bars in the base:
  - Each bar at HVE level → contributes 2.0 HVQ-equivalents
  - Each bar at HVY level → contributes 1.5 HVQ-equivalents
  - Each bar at HVQ level → contributes 1.0 HVQ-equivalents
- Sum all HVQ-equivalents
- Score 1 (full value, maxPoints is 1) if aggregate ≥ 2.5 HVQ-equivalents, score 0 otherwise
- No LLM needed
**Acceptance:**
- [ ] Implements `FactorFunction` contract
- [ ] Aggregates weighted volume across multiple bars in the base
- [ ] HVE bar = 2.0, HVY bar = 1.5, HVQ bar = 1.0 weighting
- [ ] Returns 1 when aggregate ≥ 2.5 HVQ-equivalents

#### Task 2.4: Linearity Factor — Algorithmic + LLM
**Files:** Create `packages/core/src/scoring/factors/llm-linearity.ts`
**Do:**
- Implement `linearity(input: FactorInput): Promise<FactorOutput>`
- Algorithmic pre-filter: std dev of daily returns (60 bars), up-day ratio, smoothness metric
- If clearly choppy (std dev > threshold): score 0 without LLM
- If borderline/clean and `llmService` available: send OHLCV summary to Gemini for linearity assessment
- If `llmService` unavailable: score 0 with reasoning "LLM unavailable"
- Parse binary yes/no from Gemini
**Acceptance:**
- [ ] Returns score 0 for clearly choppy trends without LLM call
- [ ] Uses Gemini for borderline cases when `llmService` available
- [ ] Returns score 0 with "LLM unavailable" when no `llmService`

#### Task 2.5: Pivot Cutter Factor — Algorithmic + LLM
**Files:** Create `packages/core/src/scoring/factors/llm-pivot-cutter.ts`
**Do:**
- Implement `pivotCutter(input: FactorInput): Promise<FactorOutput>`
- Identify resistance level (highest high in last 20 bars)
- Count rejection approaches (price within 1% of resistance then reversed)
- If rejections >= 3: score 0 (IS pivot cutter) without LLM
- If rejections 0: score 1 (NOT pivot cutter) without LLM
- If rejections 1-2 and `llmService` available: send to Gemini for nuanced assessment
- Graceful fallback when no `llmService`
**Acceptance:**
- [ ] Pure algorithmic for clear cases (0 or 3+ rejections)
- [ ] LLM for ambiguous cases (1-2 rejections)
- [ ] Graceful fallback without LLM

#### Task 2.6: AOI Factor — Algorithmic + LLM
**Files:** Create `packages/core/src/scoring/factors/llm-aoi.ts`
**Do:**
- Implement `areaOfInterest(input: FactorInput): Promise<FactorOutput>`
- Calculate prior resistance levels from last 120 bars
- Check round number proximity
- Check if multiple levels converge within 2%
- Send structure summary to Gemini for assessment when `llmService` available
- Graceful fallback without LLM
**Acceptance:**
- [ ] Detects confluence zones algorithmically
- [ ] Uses Gemini for nuanced AOI assessment
- [ ] Graceful fallback without LLM

#### Task 2.7: Wire 5 Factors into Engine + Tests
**Files:** Modify `packages/core/src/scoring/engine.ts`. Create `packages/core/tests/llm-factors.test.ts`
**Do:**
- Add 5 entries to `FACTOR_FNS` map: `linearity`, `not_pivot_cutter`, `aoi`, `hve_hvy`, `hvq_2_5`
- Import the 5 new factor functions
- Write tests for all 5 factors with sample OHLCV data (no actual LLM calls — mock `llmService`)
- Verify all 104+ existing tests still pass
**Acceptance:**
- [ ] `FACTOR_FNS` has 13 entries (8 existing + 5 new)
- [ ] All 5 new factors are testable with mocked data
- [ ] All existing tests pass unchanged

---

### Phase 3: Enhanced Existing Factors

> **Dependency:** Phase 1 complete (can run parallel with Phase 2)

#### Task 3.1: EP Catalyst — Perplexity Enhancement
**Files:** Modify `packages/core/src/scoring/factors/ep-catalyst.ts`. Create `packages/core/tests/ep-catalyst-llm.test.ts`
**Do:**
- After gap detection (or without gap), query Perplexity via `input.llmService.research()`: "Has {symbol} had any recent earnings surprises, regulatory approvals, major contracts, or catalysts in the last 5 trading days? NSE India stock."
- If Perplexity finds catalyst even without gap: score 1
- If gap detected but Perplexity says corporate action (split/bonus): score 0
- Fallback: if `llmService` unavailable, use existing gap-only logic
- New tests with mocked Perplexity responses
**Acceptance:**
- [ ] Queries Perplexity when `llmService` available
- [ ] Falls back to gap-only logic when unavailable
- [ ] Existing ep-catalyst tests pass unchanged
- [ ] New tests cover LLM-enhanced path

#### Task 3.2: Pattern Quality — Gemini Enhancement
**Files:** Modify `packages/core/src/scoring/factors/pattern-quality.ts`. Create `packages/core/tests/pattern-quality-llm.test.ts`
**Do:**
- After algorithmic VCP detection, if score is 0.5 (partial VCP) and `llmService` available:
  - Send OHLCV data to Gemini for pattern assessment (VCP, IH&S, Cup & Handle)
  - If Gemini confirms: upgrade 0.5 to 1.0
  - If Gemini rejects: keep 0.5 or downgrade to 0
- Fallback: if `llmService` unavailable, use existing algorithmic score
- New tests with mocked Gemini responses
**Acceptance:**
- [ ] Sends borderline cases to Gemini when available
- [ ] Falls back to algorithmic-only when unavailable
- [ ] Existing pattern-quality tests pass unchanged
- [ ] New tests cover LLM-enhanced path

---

### Phase 4: ScoringEngine Integration

> **Dependency:** Phases 2 and 3 complete

#### Task 4.1: ScoreResult Type + Engine Constructor
**Files:** Modify `packages/core/src/scoring/engine.ts`, `packages/core/src/scoring/index.ts`
**Do:**
- Rename `AlgorithmicScoreResult` to `ScoreResult`
- Add fields: `discretionaryScore: number`, `totalScore: number`
- Change `status` from literal `'PARTIAL'` to `'PARTIAL' | 'COMPLETE'`
- Add optional `llmService?: LLMService` as 4th constructor param
- Update `scoring/index.ts` re-export: `AlgorithmicScoreResult` → `ScoreResult`
**Acceptance:**
- [ ] `ScoreResult` type has `discretionaryScore`, `totalScore`, dynamic `status`
- [ ] Constructor accepts optional 4th param
- [ ] `scoring/index.ts` re-export updated
- [ ] All existing tests pass (no LLMService = existing behavior)

#### Task 4.2: scoreSymbol + scoreBatch Integration
**Files:** Modify `packages/core/src/scoring/engine.ts`
**Do:**
- In `scoreSymbol()`: pass `llmService: this.llmService` in `FactorInput`
- Compute `discretionaryScore` = sum of 5 LLM factor scores
- Compute `totalScore` = `algorithmicScore + discretionaryScore`
- Set `status = 'COMPLETE'` when all 13 factors have non-null scores, `PARTIAL` otherwise
- In `scoreBatch()`: add 5 discretionary params to `insertStockScore()` call:
  - `linearity: factorScore(result, 'linearity')`
  - `notPivotCutter: factorScore(result, 'not_pivot_cutter')`
  - `aoi: factorScore(result, 'aoi')`
  - `hveHvy: factorScore(result, 'hve_hvy')`
  - `hvq2_5: factorScore(result, 'hvq_2_5')`
- Update `discretionary_score` and `total_score` in the DB insert
- Increment `context.llmCalls` for each LLM API call
**Acceptance:**
- [ ] With LLMService: all 13 factors scored, status COMPLETE
- [ ] Without LLMService: 8 factors scored, status PARTIAL (existing behavior)
- [ ] `scoreBatch()` stores all 13 factor values in DB
- [ ] `context.llmCalls` tracks LLM usage

#### Task 4.3: Engine Integration Tests
**Files:** Create test for COMPLETE scoring path
**Do:**
- Test `ScoringEngine` with mocked `LLMService` — verify 13 factors scored
- Test `ScoringEngine` without `LLMService` — verify 8 factors, PARTIAL status
- Test `scoreBatch()` stores all 13 columns in DB
- Verify existing `scoring-engine.test.ts` passes unchanged
**Acceptance:**
- [ ] New test verifies COMPLETE scoring with mocked LLMService
- [ ] Existing engine tests pass unchanged

---

### Phase 5: Self-Sufficient Commands

> **Dependency:** Phase 4 complete

#### Task 5.1: CommandContext Utility
**Files:** Create `packages/cli/src/utils/command-context.ts`
**Do:**
- Implement `createCommandContext(): Promise<CommandContext>` that handles:
  - `loadConfig()`
  - `createDatabase()`
  - `SessionManager.ensureAuthenticated()` for auto-auth
  - LLM service creation (if `config.llm.enabled`)
  - `ScoringEngine` instantiation with LLM service
- Return `{ config, db, queries, provider, llmService, engine }`
**Acceptance:**
- [ ] Single function sets up entire command context
- [ ] Auto-authenticates without manual TOTP
- [ ] Creates LLM service when enabled, null when disabled

#### Task 5.2: Watchlist URL Scraper
**Files:** Create `packages/core/src/api/watchlist-scraper.ts`, `packages/core/tests/watchlist-scraper.test.ts`
**Do:**
- Implement `scrapeWatchlistUrl(url: string): Promise<ScrapeResult>`
- Fetch HTML with `fetch()`
- Parse TradingView symbols from HTML (`data-symbol`, `<script>` blocks, `NSE:` prefixed symbols)
- If HTML parsing fails and `llmService` available, fall back to Perplexity: "List all stock symbols in this TradingView watchlist: {url}"
- Return `{ symbols: string[], source: string, format: 'tradingview' | 'unknown' }`
- Tests with mocked HTML responses
**Acceptance:**
- [ ] Extracts symbols from TradingView watchlist HTML
- [ ] Falls back to Perplexity when HTML parsing fails
- [ ] Returns clean symbol list for `mapSymbols()` pipeline

#### Task 5.3: Import Command — Multi-Mode
**Files:** Modify `packages/cli/src/commands/import-cmd.ts`
**Do:**
- Auto-detect input mode from first arg:
  - Starts with `http://` or `https://` → URL scrape mode (use `scrapeWatchlistUrl()`)
  - Looks like symbols (uppercase, no path separators) → symbol list mode
  - Otherwise → existing CSV file mode
- Symbol list mode: resolve via instrument master + `mapSymbols()`, add to watchlist
- URL mode: scrape → resolve → add to watchlist
- Use `createCommandContext()` for auth/provider setup
- Add `--broker` flag (stub: prints "Coming soon" message)
**Acceptance:**
- [ ] `stark import RELIANCE TCS` works with symbol list
- [ ] `stark import https://...` scrapes and imports
- [ ] `stark import file.csv` still works (existing behavior)
- [ ] `stark import --broker` prints stub message

#### Task 5.4: Auth Command — Auto TOTP
**Files:** Modify `packages/cli/src/commands/auth.ts`
**Do:**
- Add `--auto` flag
- When `--auto` and `config.angelOne.totpSecret` is set: auto-generate TOTP, authenticate
- When `--auto` and no secret: print error with instructions to add `totpSecret` to config
- Existing manual `--totp=<code>` flow unchanged
**Acceptance:**
- [ ] `stark auth --auto` generates TOTP and authenticates
- [ ] Falls back to error message when no `totpSecret`
- [ ] Existing `--totp=<code>` flow unchanged

#### Task 5.5: Score Command — Positional Arg
**Files:** Modify `packages/cli/src/commands/score.ts`
**Do:**
- Accept positional arg: `stark score RELIANCE` (not just `--symbol=`)
- Use `createCommandContext()` for auto-auth + LLM
- Resolve symbol via instrument master
- Auto-fetch OHLCV data
- Score all 13 factors (when LLM enabled) or 8 (when disabled)
- Show complete factor breakdown with scores and reasoning
**Acceptance:**
- [ ] `stark score RELIANCE` works with positional arg
- [ ] Shows all 13 factors when LLM enabled
- [ ] Falls back to 8 factors when LLM disabled

#### Task 5.6: Evening Command — Full Auto-Scoring
**Files:** Modify `packages/cli/src/commands/evening.ts`
**Do:**
- Use `createCommandContext()` (replaces auth boilerplate)
- Score all 13 factors for watchlist stocks
- Generate COMPLETE focus list with trade plans (entry price, stop, position size)
- Output formatted report
**Acceptance:**
- [ ] Produces COMPLETE scores (13 factors) when LLM enabled
- [ ] Produces PARTIAL scores (8 factors) when LLM disabled (existing behavior)
- [ ] Focus list includes trade plans

#### Task 5.7: Morning Command — Overnight News
**Files:** Modify `packages/cli/src/commands/morning.ts`
**Do:**
- Use `createCommandContext()`
- Query Perplexity for overnight news on focus stocks (when available)
- Validate setups: re-fetch quote, check if price gapped beyond stop
- Output morning briefing
**Acceptance:**
- [ ] Queries Perplexity for overnight news when LLM enabled
- [ ] Validates setups against current price
- [ ] Works without LLM (skips news, still validates)

#### Task 5.8: Remaining Commands (entry, market, review)
**Files:** Modify `packages/cli/src/commands/entry.ts`, `market.ts`, `review.ts`
**Do:**
- **entry.ts**: `stark entry RELIANCE` — auto-fetch price, look up latest score/regime/stop, calculate position size, show summary with y/n confirmation
- **market.ts**: auto-fetch MBI, add LLM market narrative via Gemini when enabled, show sector flow
- **review.ts**: change header to "Override Review (optional)", show LLM-assessed scores, allow overrides only
- All use `createCommandContext()`
**Acceptance:**
- [ ] `stark entry RELIANCE` auto-fills price, stop, position size
- [ ] `stark market` shows LLM narrative when enabled
- [ ] `stark review` is override-only mode
- [ ] All commands gracefully handle missing config/auth

---

### Phase 6: Verification

> **Dependency:** Phase 5 complete

#### Task 6.1: Integration Tests
**Files:** Create `packages/core/tests/llm-integration.test.ts`, `packages/cli/tests/command-context.test.ts`, `packages/core/tests/session-manager-integration.test.ts`
**Do:**
- End-to-end scoring test with mocked LLM → verify COMPLETE status
- CommandContext test → verify auth, LLM, engine setup
- Session manager integration → verify full auth flow
**Acceptance:**
- [ ] Integration tests pass with mocked externals
- [ ] 30+ new tests total across all phases

#### Task 6.2: Full Regression + Verification
**Do:**
- `bun run test` — all tests pass (existing + new)
- `bun run typecheck` — zero type errors
- Verify mock provider path: LLM disabled → PARTIAL scores, identical to pre-change behavior
- Verify LLM path: LLM enabled → COMPLETE scores with all 13 factors
- Verify cache: scoring twice → second run uses cached LLM responses
- Verify error handling: Gemini error → graceful degradation to PARTIAL
- Verify rate limiting: batch scoring respects Angel One rate limiter
**Acceptance:**
- [ ] All existing 104+ tests pass
- [ ] All new tests pass
- [ ] `bun run typecheck` zero errors
- [ ] Mock provider path identical to pre-change behavior
- [ ] LLM path produces COMPLETE scores
- [ ] Cache prevents duplicate LLM calls
- [ ] Error handling shows useful messages, not stack traces

---

## Definition of Done

All of the following must be true:
1. `bun run test` passes (all existing + 30+ new tests)
2. `bun run typecheck` passes with zero errors
3. `stark evening` with LLM enabled → COMPLETE 13-factor focus list
4. `stark score RELIANCE` → auto-fetch + all 13 scores
5. `stark import RELIANCE TCS` → adds to watchlist
6. `stark import https://tradingview.com/watchlists/...` → scrapes and imports
7. `stark morning` → overnight news + setup validation
8. `stark auth --auto` → TOTP auto-generation
9. All commands work without LLM (graceful degradation)
10. All commands auto-authenticate (when `totpSecret` configured)
11. LLM responses cached and reused within TTL
