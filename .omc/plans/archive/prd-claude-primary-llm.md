# PRD: Claude-Primary LLM Integration

**Date:** 2026-03-08
**Status:** APPROVED (Ralplan Consensus: Planner + Architect + Critic)
**Source Plan:** `.omc/plans/llm-mandatory.md`

---

## Problem Statement

Stark-Trading's LLM integration uses Gemini as the only analysis provider and has a cluttered API surface (fabricated config objects, redundant `isEnabled()` calls, hardcoded `dataSource: 'gemini'`). The user wants Claude (Anthropic) as the primary analysis engine, with Gemini as fallback, while keeping LLM fully opt-in so the app works without any API keys.

## Goals

1. Add Claude as the primary analysis provider (Anthropic Messages API)
2. Implement Claude > Gemini priority routing with runtime fallback cascade
3. Clean up the LLM API surface (remove redundant params, fabricated configs, `isEnabled()`)
4. Add degraded signaling when LLM is configured but fails at runtime
5. Add `stark setup` wizard for guided API key configuration
6. Maintain full backward compatibility (app works with zero LLM keys)

## Non-Goals

- Strategy pattern / provider registry (deferred — over-engineered for 2 providers)
- Cost budgeting / token counting (future work)
- Prompt versioning (future work)
- Changing `llm-volume-events.ts` or `llm-volume-quality.ts` (purely algorithmic)

## Technical Constraints

- Direct HTTP `fetch()` for Claude API — no `@anthropic-ai/sdk` dependency
- `llmService: LLMService | null` stays nullable (LLM is opt-in)
- `if (llmService)` guards STAY in factors and commands
- `enabled: boolean` remains as user-facing master toggle
- Tests run from `/mnt/c/Projects/SteveTrading`, source on `/mnt/d/Projects/SteveTrading`
- Copy changed files from `/mnt/d/` to `/mnt/c/` before running `bun test`

---

## Implementation Phases

### Phase 1: Claude Client + Config
**Files:** `packages/core/src/llm/claude-client.ts` (NEW), `packages/core/src/config/index.ts`, `packages/core/src/llm/index.ts`

**Tasks:**
- [ ] 1.1: Create `ClaudeClient` class (same `analyze(prompt, data?)` interface as `GeminiClient`)
  - Endpoint: `https://api.anthropic.com/v1/messages`
  - Headers: `x-api-key`, `anthropic-version: 2023-06-01`
  - Model: `claude-sonnet-4-20250514`
  - System prompt requesting JSON: `{"score": <0|0.5|1>, "reasoning": "<text>", "confidence": <0-1>}`
  - Parse from `content[0].text`, normalize, cache via `LLMCache`
- [ ] 1.2: Add `anthropicKey?: string` to `LLMConfig` in `config/index.ts`
- [ ] 1.3: Add barrel export in `llm/index.ts`

**Acceptance Criteria:**
- `ClaudeClient.analyze()` returns `LLMAnalysisResult` with `providerUsed: 'claude'`
- Uses direct `fetch()` — zero npm dependencies added
- Caches via `LLMCache` with model identifier `'claude-sonnet-4-20250514'`
- `LLMConfig.anthropicKey` is optional (`?`)
- `StarkConfig.llm` remains optional (`?`)

---

### Phase 2: LLM Service Refactor
**Files:** `packages/core/src/llm/llm-service.ts`, `packages/core/src/llm/gemini-client.ts`

**Tasks:**
- [ ] 2.1: Add `private claude: ClaudeClient | null` field; create in constructor when `anthropicKey` set
- [ ] 2.2: Change `LLMService` interface — remove `config` param from `analyzeOHLCV()` and `research()`, remove `isEnabled()`, add `canAnalyze()`, `canResearch()`, `getAnalysisProvider()`
- [ ] 2.3: Implement provider-priority routing with runtime fallback cascade:
  - Claude set → try Claude → on failure, cascade to Gemini if set → else throw
  - Only Gemini set → use Gemini
  - Neither set → return empty result `{ score: 0, reasoning: 'No analysis provider configured', ... }`
- [ ] 2.4: Add `providerUsed?: string` to `LLMAnalysisResult` interface
- [ ] 2.5: Add `providerUsed: 'gemini'` to `GeminiClient.analyze()` return

**New interface:**
```typescript
export interface LLMService {
  analyzeOHLCV(prompt: string, bars: OHLCVBar[]): Promise<LLMAnalysisResult>;
  research(query: string): Promise<ResearchResult>;
  canAnalyze(): boolean;
  canResearch(): boolean;
  getAnalysisProvider(): string;
}
```

**Acceptance Criteria:**
- Claude preferred over Gemini when both keys present
- Runtime cascade: Claude failure + Gemini key → Gemini used automatically
- No `config` parameter on any method
- No `isEnabled()` method
- Constructor handles all keys absent gracefully (no throw)
- `getAnalysisProvider()` returns `'claude'`, `'gemini'`, or `'none'`

---

### Phase 3: Degraded Signaling + Factor Cleanup
**Files:** `registry.ts`, `context.ts`, `engine.ts`, `models/score.ts`, `llm-linearity.ts`, `llm-pivot-cutter.ts`, `llm-aoi.ts`, `ep-catalyst.ts`, `pattern-quality.ts`, `watchlist-scraper.ts`, `market.ts`, `morning.ts`, `registry.ts` (descriptions)

**Tasks:**
- [ ] 3.1: Add `degraded?: boolean` to `FactorOutput` in `registry.ts`
- [ ] 3.2: Add `degradedFactors: string[]` to `ScoringContext` in `context.ts` with `trackDegradedFactor()` helper
- [ ] 3.3: Add `degradedFactors: string[]` to `ScoreResult` in `engine.ts`; track degraded factors in `scoreSymbol()`
- [ ] 3.4: Add `degraded?: boolean` to `FactorResult` in `models/score.ts`
- [ ] 3.5: Clean up `llm-linearity.ts` — remove fabricated config + `isEnabled()`, simplify to `if (llmService)`, use `analyzeOHLCV(prompt, bars)`, use `getAnalysisProvider()` for dataSource, add `degraded: true` in catch
- [ ] 3.6: Clean up `llm-pivot-cutter.ts` — same pattern as 3.5
- [ ] 3.7: Clean up `llm-aoi.ts` — same pattern as 3.5
- [ ] 3.8: Clean up `ep-catalyst.ts` — remove fabricated config, change `research(query, config)` to `research(query)`, add `degraded: true` in catch blocks (MUST NOT re-throw)
- [ ] 3.9: Clean up `pattern-quality.ts` — remove fabricated config, change `analyzeOHLCV(prompt, bars, config)` to `analyzeOHLCV(prompt, bars)`, use `getAnalysisProvider()`, add `degraded: true` in catch
- [ ] 3.10: Clean up `watchlist-scraper.ts` — remove fabricated config, change `research(query, config)` to `research(query)`
- [ ] 3.11: Clean up `market.ts` — remove fabricated config, change `analyzeOHLCV(prompt, [], config)` to `analyzeOHLCV(prompt, [])`
- [ ] 3.12: Clean up `morning.ts` — remove fabricated config, change `research(query, config)` to `research(query)`
- [ ] 3.13: Update registry description strings — change `'optional Gemini'` to `'optional LLM'`

**DO NOT TOUCH:** `llm-volume-events.ts`, `llm-volume-quality.ts`

**Acceptance Criteria:**
- Zero fabricated config objects in ANY file
- Zero `isEnabled()` calls in ANY file
- Zero `config` parameter on `analyzeOHLCV()` or `research()` calls
- All `if (llmService)` / `if (input.llmService)` guards remain intact
- `dataSource` uses `getAnalysisProvider()` not hardcoded `'gemini'`
- All catch blocks include `degraded: true`
- `degradedFactors` tracked through context → engine → result

---

### Phase 4: Setup Wizard + CLI Updates
**Files:** `setup.ts` (NEW), `stark.ts`, `command-context.ts`, `status.ts`, `score.ts`

**Tasks:**
- [ ] 4.1: Create `stark setup` wizard — interactive prompts for Anthropic (primary), Perplexity (research), Gemini (fallback). All skippable. Writes to `~/.stark/config.json`.
- [ ] 4.2: Wire `setup` command in `stark.ts`
- [ ] 4.3: Update `command-context.ts` — include `anthropicKey` in LLM creation condition
- [ ] 4.4: Update `status.ts` — add Anthropic key status, show active analysis provider
- [ ] 4.5: Update `score.ts` — display degraded factor summary when applicable

**Acceptance Criteria:**
- `stark setup` allows skipping ALL keys
- `stark --help` shows the `setup` command
- `command-context.ts` creates LLM when ANY key present (not just Gemini)
- `stark status` shows all three key statuses + active provider
- `stark score` shows degraded summary when factors are degraded
- App starts and runs all commands with NO LLM keys

---

### Phase 5: Tests + Verification
**Files:** `llm-service.test.ts`, `llm-factors.test.ts`, `ep-catalyst-llm.test.ts`, `pattern-quality-llm.test.ts`, `llm-integration.test.ts`

**Tasks:**
- [ ] 5.1: Add `ClaudeClient` unit tests (success, caching, error handling)
- [ ] 5.2: Update `LLMServiceImpl` tests — provider combinations (Claude only, Gemini only, both, neither), `canAnalyze()`, `getAnalysisProvider()`, remove `isEnabled()` tests
- [ ] 5.3: Update factor tests — new mock interface (no `isEnabled`, no config params), add degraded signaling tests, keep null-LLM tests
- [ ] 5.4: Copy all changed files from `/mnt/d/` to `/mnt/c/` and run `bun test`
- [ ] 5.5: Verification grep — zero matches in `packages/` for:
  - `isEnabled\(`
  - `geminiKey: 'check'`
  - `perplexityKey: 'check'`
  - `config: LLMConfig` in LLMService method signatures
  - `'optional Gemini'`
  - `dataSource: 'gemini'` (hardcoded)

**Acceptance Criteria:**
- All tests pass with `bun test`
- ClaudeClient has unit tests (success, cache, error)
- LLMServiceImpl tests cover all 4 provider combinations
- Factor tests cover with-LLM, without-LLM (null), and degraded paths
- `tsc --noEmit` zero errors (run from `/mnt/c/`)
- All verification greps return zero matches

---

## Success Criteria (Definition of Done)

1. App starts and runs ALL commands with ZERO LLM keys configured
2. Claude is primary analysis provider when its key is set
3. Gemini is fallback when only its key is set (backward compatible)
4. Claude preferred when both Claude + Gemini keys are set
5. Runtime fallback cascade: Claude failure + Gemini key → Gemini used automatically
6. Perplexity used independently for research when its key is set
7. `LLMService` interface: no `isEnabled()`, no `config` param on methods
8. Zero fabricated config objects in entire codebase
9. `degradedFactors[]` tracked through ScoringContext → ScoreResult → CLI output
10. `stark setup` wizard: all three keys configurable, all skippable
11. `stark status` shows all key statuses + active analysis provider
12. All tests pass; degraded-path tests exist; null-LLM tests remain valid
13. `llm-volume-events.ts` and `llm-volume-quality.ts` untouched
14. `enabled: boolean` remains as user-facing master toggle
15. Zero npm dependencies added (Claude API via direct HTTP fetch)
