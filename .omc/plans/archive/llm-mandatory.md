# Plan: Claude-Primary LLM Integration (Opt-In, Non-Blocking)

**Date:** 2026-03-08
**Status:** REVISED (Architect Review R1)
**Complexity:** MEDIUM
**Scope:** ~18 files across `packages/core` and `packages/cli`

---

## Context

The Stark-Trading project currently uses Gemini for chart analysis and Perplexity for financial research, both opt-in. The user wants to restructure the LLM provider hierarchy:

1. **Claude (Anthropic) becomes the PRIMARY analysis engine** -- replaces Gemini for chart analysis, scoring factors, and market narrative
2. **Perplexity remains the research engine** -- specifically for financial news, catalysts, corporate actions (Perplexity Finance)
3. **Gemini becomes secondary/fallback** -- still available if Claude key is not set but Gemini key is
4. **LLM stays opt-in, NEVER blocking** -- all static/algorithmic features work fully without any API keys
5. **Setup wizard encourages LLM** -- but allows skipping with a clear explanation of what each key unlocks
6. **Degraded signaling** -- when LLM IS configured but fails at runtime, factors signal degradation rather than silent zeros

### What Exists Now

- `LLMConfig`: `geminiKey?: string`, `perplexityKey?: string`, `enabled: boolean` -- all optional
- `LLMServiceImpl`: creates `GeminiClient` if key present, `PerplexityClient` if key present
- `LLMService` interface: `analyzeOHLCV(prompt, bars, config)`, `research(query, config)`, `isEnabled(config)`
- `CommandContext`: `llmService: LLMService | null` -- null when no keys configured
- 5 LLM factor files (`llm-linearity.ts`, `llm-pivot-cutter.ts`, `llm-aoi.ts`, `llm-volume-events.ts`, `llm-volume-quality.ts`) -- all use `if (llmService && llmService.isEnabled(...))` guards with fabricated inline configs
- `ep-catalyst.ts`, `pattern-quality.ts` -- also use `if (input.llmService)` guards for optional LLM calls
- Factor LLM calls all pass fabricated config objects like `{ enabled: true, geminiKey: 'check', cacheResponses: true, cacheTtlHours: 24 }`
- `isEnabled()` method takes a `LLMConfig` parameter redundantly (service already has config from constructor)

### What Is Wrong With Current Code

1. **No Claude support** -- Gemini is the only analysis provider; user wants Claude as primary
2. **Redundant API surface** -- `isEnabled(config)` and passing `config` to every method call is redundant; the service already has config from constructor
3. **Fabricated config objects** -- Factors create fake `LLMConfig` objects like `{ enabled: true, geminiKey: 'check' }` just to call `isEnabled()` -- this is a code smell
4. **`dataSource` labels hardcoded to 'gemini'** -- factors report `dataSource: 'gemini'` even though the provider should be abstracted
5. **No degraded signaling** -- when LLM fails at runtime, factors silently fall through to `score: 0` with no indication that accuracy was reduced

---

## RALPLAN-DR Summary

### Principles

1. **LLM is opt-in, never blocking** -- The app MUST work fully without any API keys. `stark score`, `stark morning`, all commands function with algorithmic-only scoring.
2. **Claude first, Gemini fallback, Perplexity for research** -- Analysis calls try Claude, fall back to Gemini. Research calls use Perplexity. Each provider is independently optional.
3. **Simplify the API surface** -- Remove `config` parameter from method signatures (use constructor config), remove `isEnabled()` (check internally), remove fabricated config objects from factors.
4. **Degraded over silent** -- When LLM IS configured but a call fails, track `degraded: true` so the user knows which factors had reduced accuracy.
5. **Backward compatible** -- Existing users without any LLM keys must not break. The `llm?: LLMConfig` optional field stays optional.

### Decision Drivers

1. **Non-blocking UX** -- User explicitly stated "should have option to skip LLM setup and still use static features". No startup validation that throws.
2. **Provider flexibility** -- Claude is primary today, but the architecture should make it easy to add/swap providers. The `LLMService` interface abstracts over providers.
3. **Code quality** -- Eliminating fabricated config objects, redundant parameters, and hardcoded provider names makes the codebase cleaner and more maintainable.

### Options

**Option A: Add Claude client, provider-priority routing in LLMServiceImpl** -- CHOSEN
- Create `claude-client.ts` with same `analyze()` interface as `GeminiClient`
- Add `anthropicKey?: string` to `LLMConfig`
- `LLMServiceImpl.analyzeOHLCV()` tries Claude first (if key set), falls back to Gemini (if key set), returns "not configured" if neither
- Simplify method signatures: remove `config` parameter from `analyzeOHLCV()` and `research()`
- Remove `isEnabled()` from interface; add internal `hasAnalysisProvider()` and `hasResearchProvider()` methods
- Factors use simplified call: `llmService.analyzeOHLCV(prompt, bars)` -- no config, no isEnabled check
- Keep `llmService: LLMService | null` pattern in CommandContext (null = no keys)
- Add `degraded?: boolean` to `FactorOutput`
- Pros: Minimal blast radius; clean separation of concerns; backward compatible; compiler does not force changes everywhere since `| null` stays
- Cons: Factors still need `if (llmService)` guards (but these are correct -- LLM IS optional)

**Option B: Abstract provider behind strategy pattern with provider registry**
- Create `AnalysisProvider` interface, `ClaudeProvider`, `GeminiProvider` implementations
- `LLMServiceImpl` holds a ranked list of providers, tries each in order
- Pros: More extensible; easy to add future providers (Mistral, etc.)
- Cons: Over-engineered for 2 analysis providers; more files and abstractions; larger blast radius
- DEFERRED: Not invalidated, but unnecessary complexity for current scope. Can be adopted later if a third analysis provider is added.

### ADR

- **Decision:** Option A -- Add Claude client with priority routing in LLMServiceImpl
- **Drivers:** Minimal blast radius; Claude is the user's primary preference; backward compatibility maintained; code cleanup (remove redundant params) improves quality without restructuring
- **Alternatives considered:** Strategy pattern (Option B) -- deferred as over-engineering for 2 providers
- **Why chosen:** Follows the existing pattern (add a client, wire it in the service), addresses all user requirements without introducing new abstractions
- **Consequences:** `LLMConfig` grows by one field (`anthropicKey`); method signatures change (remove `config` param); `isEnabled()` removed from interface; factors get simpler LLM calls
- **`enabled` field fate:** The `enabled: boolean` field remains as a user-facing master toggle. When `enabled: false`, `command-context.ts` skips LLM construction entirely, regardless of which keys are present. This gives users a quick way to disable LLM without deleting keys.
- **Follow-ups:** If a third analysis provider is ever added, reconsider Option B. Prompt versioning and cost budgeting are separate concerns for a future plan.

---

## Work Objectives

1. Create `claude-client.ts` as the primary analysis provider (Anthropic Messages API, direct HTTP)
2. Add `anthropicKey?: string` to `LLMConfig`; keep all fields optional; keep `llm?: LLMConfig` optional on `StarkConfig`
3. Simplify `LLMService` interface: remove `config` parameter from methods, remove `isEnabled()` method
4. Implement provider-priority routing: Claude > Gemini for analysis, Perplexity for research
5. Clean up all 7 factor files: remove fabricated config objects, simplify LLM calls, add `degraded` signaling
6. Add `stark setup` wizard for guided API key configuration (all keys skippable)
7. Update CLI commands and tests

## Guardrails

**Must Have:**
- App works fully without ANY LLM keys (all commands, all algorithmic scoring)
- `llmService: LLMService | null` stays nullable in `CommandContext` and `FactorInput`
- `if (llmService)` / `if (input.llmService)` guards STAY in factors and commands (they are correct)
- Claude tried first for analysis, Gemini as fallback, when both keys are present
- `degraded?: boolean` on `FactorOutput` when LLM was configured but call failed
- `stark setup` allows skipping ALL keys
- Direct HTTP fetch for Claude API (no SDK dependency)

**Must NOT Have:**
- Any startup validation that throws/exits when LLM keys are missing
- Any `isEnabled(config)` calls with fabricated config objects
- Any `config: LLMConfig` parameter on `analyzeOHLCV()` or `research()` method signatures
- Hardcoded `dataSource: 'gemini'` in factors -- use the actual provider name returned by the service
- Changes to `llm-volume-events.ts` or `llm-volume-quality.ts` (purely algorithmic, no LLM calls despite the `llm-` prefix)

---

## Task Flow

```
Step 1 (Claude client + config)
    |
    v
Step 2 (LLM service refactor)
    |
    v
Step 3 (Degraded signaling + factor cleanup)
    |
    v
Step 4 (Setup wizard + CLI commands)
    |
    v
Step 5 (Tests + verification)
```

---

## Detailed TODOs

### Step 1: Create Claude client and update config

**Files:**
- `packages/core/src/llm/claude-client.ts` (NEW)
- `packages/core/src/config/index.ts`
- `packages/core/src/llm/index.ts` (barrel export)

**Changes -- `claude-client.ts` (NEW):**
1. Create `ClaudeClient` class following the same pattern as `GeminiClient`
2. Constructor takes `apiKey: string` and `cache: LLMCache`
3. Use Anthropic Messages API via direct HTTP fetch (no SDK):
   - Endpoint: `https://api.anthropic.com/v1/messages`
   - Headers: `x-api-key`, `anthropic-version: 2023-06-01`, `Content-Type: application/json`
   - Model: `claude-sonnet-4-20250514`
4. Method: `analyze(prompt: string, data?: unknown): Promise<LLMAnalysisResult>` -- same signature as `GeminiClient.analyze()`
5. Request body: system prompt requesting JSON response `{"score": <0|0.5|1>, "reasoning": "<text>", "confidence": <0-1>}`
6. Parse response from `content[0].text`, normalize score/confidence, cache result
7. Cache model identifier: `'claude-sonnet-4-20250514'`

**Changes -- `config/index.ts`:**
1. Add `anthropicKey?: string` to `LLMConfig` interface (all keys remain optional)
2. Keep `enabled: boolean` for now (will be simplified in Step 2, but changing it here would break the constructor)
3. NO changes to `StarkConfig.llm?` -- stays optional

**Changes -- `llm/index.ts`:**
1. Add barrel export: `export { ClaudeClient } from './claude-client.js'`

**Acceptance Criteria:**
- `ClaudeClient` follows the exact same interface pattern as `GeminiClient` (`analyze(prompt, data?) -> LLMAnalysisResult`)
- Uses direct `fetch()` to Anthropic Messages API -- no npm dependency
- Caches responses via `LLMCache` (same as Gemini/Perplexity)
- `LLMConfig` has `anthropicKey?: string` (optional)
- `StarkConfig.llm` remains `llm?: LLMConfig` (optional)

### Step 2: Refactor LLM service -- provider priority, simplified API

**Files:**
- `packages/core/src/llm/llm-service.ts`

**Changes:**
1. Add `private claude: ClaudeClient | null = null` field
2. In constructor: if `config.anthropicKey` is set, create `ClaudeClient`
3. Update `isEnabled()` to include `anthropicKey`: `return config.enabled && !!(config.anthropicKey || config.geminiKey || config.perplexityKey)`
4. **Simplify `analyzeOHLCV` signature:** change from `analyzeOHLCV(prompt, bars, config)` to `analyzeOHLCV(prompt, bars)` -- remove the `config` parameter (use `this.config` internally)
5. **Simplify `research` signature:** change from `research(query, config)` to `research(query)` -- remove the `config` parameter
6. **Remove `isEnabled()` from the interface.** Replace with: `canAnalyze(): boolean` (returns true if Claude or Gemini key is set) and `canResearch(): boolean` (returns true if Perplexity key is set). These are informational, NOT guards -- factors can still call methods without checking.
7. **Implement provider-priority routing with runtime fallback cascade in `analyzeOHLCV()`:**
   - If `this.claude` is set: try `this.claude.analyze(prompt, data)`
     - If Claude call succeeds: return result with `providerUsed: 'claude'`
     - If Claude call fails AND `this.gemini` is set: cascade to `this.gemini.analyze(prompt, data)`, return with `providerUsed: 'gemini'`
     - If Claude call fails AND no Gemini: throw the Claude error (caught by factor catch blocks → `degraded: true`)
   - Else if `this.gemini` is set: call `this.gemini.analyze(prompt, data)` and return with `providerUsed: 'gemini'`
   - Else: return `{ score: 0, reasoning: 'No analysis provider configured', confidence: 0, cached: false }`
   - This ensures that when both keys are configured, a Claude API outage automatically cascades to Gemini rather than degrading all analysis factors
8. **`research()` stays the same:** if `this.perplexity` is set, call it; else return `{ answer: 'Perplexity not configured', sources: [], cached: false }`
9. Add a `getAnalysisProvider(): string` method that returns `'claude'`, `'gemini'`, or `'none'` -- factors use this for `dataSource`

**Updated `LLMService` interface:**
```typescript
export interface LLMService {
  analyzeOHLCV(prompt: string, bars: OHLCVBar[]): Promise<LLMAnalysisResult>;
  research(query: string): Promise<ResearchResult>;
  canAnalyze(): boolean;
  canResearch(): boolean;
  getAnalysisProvider(): string;
}
```

**Changes -- `gemini-client.ts`:**
1. Add `providerUsed: 'gemini'` to the returned `LLMAnalysisResult`

**Changes -- `LLMAnalysisResult` (in `gemini-client.ts`):**
1. Add `providerUsed?: string` to the `LLMAnalysisResult` interface

**Acceptance Criteria:**
- `analyzeOHLCV()` tries Claude first, cascades to Gemini on Claude failure, returns empty result if neither configured
- Runtime fallback: Claude timeout/error with Gemini key configured → Gemini is used automatically
- `research()` uses Perplexity if available, returns empty result if not
- No `config` parameter on any method signature
- No `isEnabled()` method -- replaced with `canAnalyze()` and `canResearch()`
- `getAnalysisProvider()` returns the name of the preferred provider
- `LLMAnalysisResult` includes `providerUsed` field showing which provider actually handled the call
- Constructor handles all three keys being absent gracefully (no throw)

### Step 3: Add degraded signaling + clean up all factor files

**Files:**
- `packages/core/src/scoring/registry.ts` (modify `FactorOutput`)
- `packages/core/src/scoring/context.ts` (modify `ScoringContext`)
- `packages/core/src/scoring/engine.ts` (modify `ScoreResult`, update `scoreSymbol`)
- `packages/core/src/scoring/factors/llm-linearity.ts`
- `packages/core/src/scoring/factors/llm-pivot-cutter.ts`
- `packages/core/src/scoring/factors/llm-aoi.ts`
- `packages/core/src/scoring/factors/ep-catalyst.ts`
- `packages/core/src/scoring/factors/pattern-quality.ts`

**Changes -- `registry.ts`:**
1. Add `degraded?: boolean` to `FactorOutput` interface

**Changes -- `context.ts`:**
1. Add `degradedFactors: string[]` to `ScoringContext` interface
2. Initialize `degradedFactors: []` in `createScoringContext()`
3. Add helper: `export function trackDegradedFactor(ctx: ScoringContext, symbol: string, factorId: string): void`

**Changes -- `engine.ts`:**
1. Add `degradedFactors: string[]` to `ScoreResult` interface
2. In `scoreSymbol()`: after each factor runs, if `output.degraded === true`, call `trackDegradedFactor()`
3. In the per-factor catch block: mark the error result as `degraded: true`
4. Include `degradedFactors` in the returned `ScoreResult`
5. Also add `degraded?: boolean` to `FactorResult` in `models/score.ts`

**Changes -- all 5 factor files (llm-linearity, llm-pivot-cutter, llm-aoi, ep-catalyst, pattern-quality):**

For each factor, apply these changes:
1. **Remove fabricated config objects** -- delete all instances of `const config = { enabled: true, geminiKey: 'check', ... }`
2. **Remove `isEnabled()` calls** -- delete all `llmService.isEnabled({ ... })` checks
3. **Simplify LLM calls** -- change `llmService.analyzeOHLCV(prompt, bars, config)` to `input.llmService.analyzeOHLCV(prompt, bars)` and `llmService.research(query, config)` to `input.llmService.research(query)`
4. **Keep the `if (llmService)` guard** -- this is correct because `llmService` is nullable (LLM is opt-in)
5. **Update `dataSource`** -- change hardcoded `'gemini'` to `input.llmService.getAnalysisProvider()` (or `'perplexity'` for research calls)
6. **Add degraded signaling** -- in the catch blocks where LLM calls fail, add `degraded: true` to the returned `FactorOutput`
7. **Keep existing algorithmic fallback logic** -- when LLM is null or fails, the algorithmic fallback is correct

**Specific factor changes:**

`llm-linearity.ts` (line 62-78):
- Remove: `if (llmService && llmService.isEnabled({ enabled: true, geminiKey: 'check', ... }))`
- Replace with: `if (llmService)`
- Remove: `const config = { ... }`
- Change: `llmService.analyzeOHLCV(prompt, recent, config)` to `llmService.analyzeOHLCV(prompt, recent)`
- Change: `dataSource: 'gemini'` to `dataSource: llmService.getAnalysisProvider()`
- Add in catch: `degraded: true` to the fallback return

`llm-pivot-cutter.ts` (line 67-83): Same pattern as linearity

`llm-aoi.ts` (line 93-109): Same pattern as linearity

`ep-catalyst.ts` (lines 47-65, 77-95):
- Remove: `const config = { enabled: true, perplexityKey: 'check', ... }`
- Change: `llmService.research(query, config)` to `input.llmService.research(query)`
- Keep: `if (input.llmService)` guard (correct)
- Add in catch blocks: `degraded: true`

`pattern-quality.ts` (lines 74-98):
- Remove: `const config = { enabled: true, geminiKey: 'check', ... }`
- Change: `input.llmService.analyzeOHLCV(prompt, bars, config)` to `input.llmService.analyzeOHLCV(prompt, bars)`
- Keep: `if (input.llmService)` guard (correct)
- Change: `dataSource: 'gemini'` to `dataSource: input.llmService.getAnalysisProvider()`
- Add in catch: `degraded: true`

**Additional files with fabricated configs (also need cleanup):**

`watchlist-scraper.ts` (line 81-84):
- Remove: fabricated `{ enabled: true, perplexityKey: 'check', ... }` config
- Change: `llmService.research(query, config)` to `llmService.research(query)`
- Keep: `if (llmService)` guard (correct)

`market.ts` (lines 33-37):
- Remove: fabricated `{ enabled: true, geminiKey: 'check', ... }` config
- Change: `llmService.analyzeOHLCV(prompt, [], llmConfig)` to `llmService.analyzeOHLCV(prompt, [])`
- Keep: `if (llmService)` guard (correct)

`morning.ts` (lines 30-33):
- Remove: fabricated `{ enabled: true, perplexityKey: 'check', ... }` config
- Change: `llmService.research(query, config)` to `llmService.research(query)`
- Keep: `if (llmService)` guard (correct)

**Registry description strings (`registry.ts`):**
- Change `'Angel One OHLCV + optional Gemini'` to `'Angel One OHLCV + optional LLM'` at lines 204, 233, 247, 261
- Change `'OHLCV + optional Gemini'` to `'OHLCV + optional LLM'` wherever it appears

**DO NOT TOUCH:** `llm-volume-events.ts`, `llm-volume-quality.ts` -- these are purely algorithmic (no LLM calls)

**Acceptance Criteria:**
- Zero fabricated config objects (`{ enabled: true, geminiKey: 'check', ... }`) in ANY file (factors, CLI commands, watchlist-scraper)
- Zero `isEnabled()` calls in any file
- Zero `config` parameter on `analyzeOHLCV()` or `research()` calls
- All `if (llmService)` / `if (input.llmService)` guards remain intact
- `dataSource` uses `getAnalysisProvider()` instead of hardcoded `'gemini'`
- All catch blocks include `degraded: true` on returned output
- `FactorOutput` has `degraded?: boolean`
- `ScoreResult` has `degradedFactors: string[]`
- `FactorResult` in `models/score.ts` has `degraded?: boolean`
- `llm-volume-events.ts` and `llm-volume-quality.ts` are unchanged

### Step 4: Add `stark setup` wizard + update CLI commands

**Files:**
- `packages/cli/src/commands/setup.ts` (NEW)
- `packages/cli/bin/stark.ts` (wire command)
- `packages/cli/src/utils/command-context.ts` (update LLM creation)
- `packages/cli/src/commands/morning.ts` (update LLM call — fabricated config already removed in Step 3)
- `packages/cli/src/commands/market.ts` (update LLM call — fabricated config already removed in Step 3)
- `packages/cli/src/commands/status.ts` (add Anthropic key display)
- `packages/cli/src/commands/score.ts` (display degraded info)

**Changes -- `setup.ts` (NEW):**
1. Interactive wizard using `process.stdin` (Bun supports `prompt()` or readline):
   - Display header: "Stark API Key Setup"
   - Explain what each key unlocks:
     - Claude (Anthropic): "Primary AI for chart analysis, scoring factors, and market narrative"
     - Perplexity: "Financial research -- news, catalysts, corporate actions"
     - Gemini: "Fallback chart analysis (used when Claude key not set)"
   - Prompt for each key with "press Enter to skip"
   - All three are skippable
   - If the user skips all: display "All static/algorithmic features are available. LLM features disabled."
   - Write keys to `~/.stark/config.json` via `saveConfig()`
   - Display summary: "Anthropic: SET/SKIPPED, Perplexity: SET/SKIPPED, Gemini: SET/SKIPPED"

**Changes -- `stark.ts`:**
1. Add `{ name: "setup", description: "Configure API keys for LLM and broker integrations" }` to COMMANDS array
2. Add `case "setup"` to the switch statement, importing `setupCommand`

**Changes -- `command-context.ts`:**
1. Update the LLM creation condition to include `anthropicKey`:
   ```typescript
   let llmService: LLMService | null = null;
   if (config.llm?.enabled && (config.llm.anthropicKey || config.llm.geminiKey || config.llm.perplexityKey)) {
     llmService = new LLMServiceImpl(config.llm, db);
   }
   ```
2. Keep `llmService: LLMService | null` -- stays nullable

**Changes -- `morning.ts`:**
1. Update `llmService.research(query, config)` call to `llmService.research(query)` (remove config param)
2. Keep the `if (llmService)` guard

**Changes -- `status.ts`:**
1. Add Anthropic key status line: `Anthropic Key: ${config.llm?.anthropicKey ? 'SET' : 'NOT SET'}`
2. Keep existing Gemini and Perplexity key display lines
3. Show which provider will be used for analysis: `Analysis Provider: ${llmService?.getAnalysisProvider() ?? 'none (algorithmic only)'}`

**Changes -- `score.ts`:**
1. After printing results, if `result.degradedFactors.length > 0`:
   ```
   "Note: N factor(s) scored with reduced accuracy due to LLM API issues: [factor names]"
   ```

**Acceptance Criteria:**
- `stark setup` launches and allows skipping all keys
- `stark setup` writes valid config to `~/.stark/config.json`
- `stark --help` shows the `setup` command
- `command-context.ts` creates `LLMServiceImpl` when ANY key is present (not just Gemini)
- `command-context.ts` keeps `llmService: LLMService | null` (null when no keys)
- All CLI LLM calls use simplified signatures (no config param)
- `stark score` displays degraded factor summary when applicable
- App starts and runs all commands successfully with NO LLM keys configured

### Step 5: Update tests + verification

**Files:**
- `packages/core/tests/llm-service.test.ts`
- `packages/core/tests/llm-factors.test.ts`
- `packages/core/tests/ep-catalyst-llm.test.ts`
- `packages/core/tests/pattern-quality-llm.test.ts`
- `packages/core/tests/llm-integration.test.ts`

**Changes for tests:**
1. **Add `ClaudeClient` tests** in `llm-service.test.ts`:
   - Mock `fetch` to simulate Anthropic Messages API response format
   - Test: successful analysis parse
   - Test: cached response on second call
   - Test: API error handling
2. **Update `LLMServiceImpl` tests:**
   - Test: constructor with `anthropicKey` only -- creates Claude, no Gemini
   - Test: constructor with both `anthropicKey` and `geminiKey` -- Claude is used for analysis (verify via fetch URL)
   - Test: constructor with `geminiKey` only -- Gemini used for analysis (backward compat)
   - Test: constructor with no keys -- `canAnalyze()` returns false, `analyzeOHLCV()` returns empty result
   - Test: `getAnalysisProvider()` returns correct provider name
   - Remove/update: `isEnabled()` tests (method no longer exists)
   - Update: `analyzeOHLCV()` and `research()` calls to use new simplified signatures (no config param)
3. **Update factor tests:**
   - Update mock LLM service to match new interface (no `isEnabled`, no config params)
   - Add degraded signaling tests: mock LLM that throws, verify `degraded: true` in output
   - Keep "without LLM" tests (llmService = null) -- this IS a valid scenario (LLM is opt-in)
4. **Verification grep** -- zero matches in `packages/` for:
   - `isEnabled\(` (removed method, except in test assertions about removal)
   - `geminiKey: 'check'` (fabricated config objects)
   - `config: LLMConfig` in method signatures of `LLMService` interface
   - `'optional Gemini'` or `'optional Claude'` in registry descriptions

**Acceptance Criteria:**
- All tests pass with `bun test`
- `ClaudeClient` has unit tests covering success, caching, and error cases
- `LLMServiceImpl` tests cover all provider combinations (Claude only, Gemini only, both, neither)
- Factor tests cover both with-LLM and without-LLM (null) paths
- Factor tests cover degraded signaling (LLM configured but throws)
- No test uses `isEnabled()` or passes `config` to `analyzeOHLCV()`/`research()`
- `tsc --noEmit` produces zero type errors
- `bun test` passes (all tests green — the 3 pre-existing `vi.setSystemTime` failures were already fixed)

---

## Success Criteria

1. The app starts and runs ALL commands successfully with ZERO LLM keys configured
2. When Claude key is set, it is used as the primary analysis provider
3. When only Gemini key is set (no Claude), Gemini is used for analysis (backward compatible)
4. When both Claude and Gemini keys are set, Claude is preferred
5. Perplexity is used independently for research when its key is set
6. The `LLMService` interface has no `isEnabled()` method and no `config` parameter on methods
7. Zero fabricated config objects in factor files
8. `degradedFactors: string[]` is tracked through `ScoringContext` -> `ScoreResult` -> CLI output
9. `stark setup` wizard allows configuring all three keys, all skippable
10. All tests pass; degraded-path tests exist; "without LLM" (null) tests remain valid
11. `llm-volume-events.ts` and `llm-volume-quality.ts` are untouched
12. Runtime fallback cascade: Claude failure with Gemini key configured → Gemini used automatically
13. `stark status` shows Anthropic/Gemini/Perplexity key status and active analysis provider
14. Zero fabricated config objects in ANY file (factors, CLI commands, watchlist-scraper)
15. `enabled: boolean` remains as user-facing master toggle
