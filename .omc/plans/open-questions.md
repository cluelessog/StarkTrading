# Open Questions

## dexter-trading-implementation - 2026-03-03 (Updated 2026-03-04)

### RESOLVED

- [x] Angel One API calls: webview vs Rust backend? -- **RESOLVED: Bun CLI calls directly in Phase 1-2 (no CORS). Phase 3+ uses `@tauri-apps/plugin-http`.**
- [x] Scheduling strategy for Tauri? -- **RESOLVED: OS cron for Phase 1-2. tokio-cron-scheduler in Rust for Phase 5.**
- [x] SQLite driver? -- **RESOLVED: `bun:sqlite` (native built-in) for CLI. `@tauri-apps/plugin-sql` for Tauri.**
- [x] Pattern detection complexity: VCP-only or all three? -- **RESOLVED: VCP heuristic is semi-discretionary in v1 (Dexter suggests, user confirms). IH&S and Cup & Handle are user-only.**
- [x] Angel One TOTP auth for automated workflows? -- **RESOLVED: Option (b) -- user authenticates once daily before 8 PM via `dexter auth`. Session token stored. No TOTP seed storage.**
- [x] Implementation Guide v4.0 discrepancies? -- **RESOLVED: All corrected in plan v2 (thresholds 8.0/8.5/9.0, 8 factors, bun:sqlite, binary Thrust Power).**

### OPEN -- API & Data

- [ ] Angel One Smart API rate limits: documented as ~1 req/sec but needs empirical testing with batch scoring of 30-50 stocks -- determines if evening workflow can complete in <5 min or needs longer
- [ ] Does Angel One historical API support 75-minute candle intervals? If not, pattern detection is daily-only for v1 -- affects Pattern Quality factor accuracy
- [ ] Angel One symbol master: how to map TradingView ticker symbols (e.g., "RELIANCE") to Angel One symbol tokens (numeric)? Need to fetch and cache the full instrument master list
- [ ] Screener.in: is there a public API, or must we scrape? If scraping, how reliable is it for IPO listing dates? Fallback: Angel One instrument master may have listing date
- [ ] Angel One refresh token mechanism: does it exist? If so, can extend session lifetime beyond daily re-auth

### OPEN -- Scoring System

- [ ] EP Catalyst detection: News API keyword matching for "earnings beat", "regulatory approval", etc. is inherently fuzzy. What false-positive rate is acceptable? Should we default to gap-only detection and let user confirm catalyst via override?
- [x] Pivot Location base detection: Minervini's method requires identifying consolidation periods (20-100 days). What algorithm to use? Simple approach: rolling ATR compression. More robust: price channel narrowing with volume decline. -- **RESOLVED: ATR compression method — 10-day ATR contracts to ≤50% of start ATR over 20-100 day consolidation, price channel ≤30% of pre-consolidation swing. Pivot = channel high. Scoring: lower third = 0, middle = 0.5, upper third = 1.0.**
- [ ] The PRD lists 13 factors (subsections) but calls it "12 subsections" -- the count includes HVE/HVY and 2.5HVQ as separate factors under Base Strength. Clarify: is it 12 or 13 distinct scoring items? (Max score 12.5 suggests 13 items where one is graduated 0/0.5/1.0)
- [ ] VCP heuristic thresholds (75% contraction, 90% volume decline) are initial estimates -- need validation with real stock data during Phase 1

### OPEN -- Architecture

- [ ] Database migrations: how to handle schema changes as scoring evolves? Options: simple version table + migration scripts, or use a migration library compatible with both `bun:sqlite` and `@tauri-apps/plugin-sql`
- [ ] DB adapter interface design: `@dexter/core` needs to abstract over `bun:sqlite` (CLI) and `@tauri-apps/plugin-sql` (Tauri). Define this interface early in Phase 1 to avoid painful migration later.

### OPEN -- User Preferences Needed

- [ ] What is the user's Angel One account type? API access may differ between free/paid tiers
- [ ] Does the user want the app to auto-start on boot (system tray) for scheduled workflows, or manual launch only? (Relevant from Phase 3+)
- [ ] Position sizing default: Rs 10,000 risk per trade is documented, but should this be configurable from day one?
- [ ] Notification preference: desktop notifications only, or also consider Telegram for evening/morning reports? (Relevant from Phase 3+)

## stark-mbi-integration - 2026-03-04

### OPEN -- Data Acquisition

- [ ] Does Chartink dashboard 291317 require login/authentication to access? -- Determines if scraper needs session management or if anonymous GET is sufficient
- [ ] Does Chartink serve dashboard data via XHR/JSON API or inline HTML table? -- Determines scraper approach (JSON parse vs DOM parse). Check browser network tab on the dashboard page.
- [ ] What is the exact NIFTY 500 constituent list source? NSE publishes it but the URL/format may change. -- Affects self-calculated breadth universe reliability
- [ ] Angel One rate limits for 500-stock OHLCV batch: at 1 req/sec, 500 stocks = ~8 minutes. Is this acceptable for the evening workflow, or should we limit self-calculated breadth to NIFTY 50 (1 minute)? -- Affects fallback quality vs speed tradeoff

### RESOLVED -- EM Formula

- [x] EM formula: approximate or exact? -- **RESOLVED: EM (Easy Money) formula is proprietary (Stocksgeeks / Finally Nitin). It measures follow-through in the market. Cannot be replicated. v1 uses Chartink as sole EM source. Fallback classifier uses raw breadth metrics without EM. Future: reverse-engineer via regression after collecting 30+ days of parallel data (Chartink EM + raw inputs).**
- [ ] Are the EM thresholds (25/15/12/9.5) fixed constants from the mentor's system, or does the user adjust them? -- Affects whether thresholds should be hardcoded or configurable (plan assumes configurable)

### OPEN -- User Preferences Needed

- [ ] Should BEAR regime (EM < 9.5) hard-block focus list generation (show 0 stocks) or soft-warn like other limits? -- Plan currently says "Avoid long trading" / 0 focus stocks, but Stark's philosophy is "soft limits, never hard blocks"
- [ ] Does the user want `stark evening` to prompt for confirmation before scoring when market is BEAR, or just display the warning and continue? -- Affects workflow UX in weak markets
- [ ] The existing plan has 3-tier regime (BULL/CHOPPY/BEAR). MBI introduces 5-tier (STRONG_BULL/BULL/CAUTIOUS/CHOPPY/BEAR). Should the trade journal and performance analytics use the 5-tier MBI regime retroactively, or maintain backward compatibility with 3-tier for older entries? -- Affects journal schema and performance report grouping

## stark-logging-system - 2026-03-04

- [ ] Should the `stark logs` command use `jq` as an external dependency for filtering, or implement basic JSON filtering in TypeScript? -- Affects whether `jq` is a runtime requirement
- [ ] Log level default for file output: should DEBUG always be written to file, or should it require `--verbose` to avoid large log files during development? -- Affects disk usage during heavy iteration
- [ ] When Phase 3 introduces a web app or Tauri UI, should the logger also write to a SQLite `logs` table for in-app log viewing, or keep file-only and read JSONL from the UI? -- Affects Phase 3 log viewer design

## stark-intraday-extensibility - 2026-03-04

### OPEN -- Intraday Design (Phase 5)

- [ ] What intraday setups does the user trade? (ORB, VWAP bounce, momentum, pullback, etc.) -- Determines setup type taxonomy for the `setup_type` field in Seam 1 and future intraday scoring factors
- [ ] What polling frequency is acceptable for intraday data? 1 min vs 5 min vs manual refresh -- Affects Angel One API budget and cache TTL strategy in Phase 5
- [ ] Should intraday risk guardrails (max daily loss, circuit breaker) be hard stops or soft warnings? -- Stark's swing philosophy is "soft limits, never hard blocks" but intraday losses compound faster; user may want hard stops
- [ ] Does the user want intraday and swing performance analytics in the same report or separate dashboards? -- Seam 6 supports filtering by trade type, but the UX question is whether they should be combined or isolated views

## stark-openalgo-feasibility - 2026-03-04

### OPEN -- Future Evaluation

- [ ] When Phase 5 (intraday) begins, re-evaluate OpenAlgo for WebSocket streaming and paper trading -- the cost/benefit changes significantly when real-time data is needed
- [ ] Is the `openalgo-node` SDK published on npm with stable releases? -- maturity of the Node.js SDK affects adoption feasibility; currently GitHub-only with unknown maintenance status
- [ ] If user ever wants to switch from Angel One to another broker (Zerodha, Groww, etc.), does OpenAlgo become the preferred path or should Stark write a new `DataProvider` implementation directly? -- depends on OpenAlgo's reliability and the target broker's API quality
- [ ] Does the user have interest in using OpenAlgo's MCP server for AI-assisted trading analysis outside of Stark (e.g., via Claude Desktop or Cursor)? -- OpenAlgo MCP could be valuable as a standalone tool even if not integrated into Stark's data pipeline

## stark-automation - 2026-03-07

### OPEN -- Security

- [ ] **TOTP seed storage security** -- The TOTP seed is stored in plaintext in `~/.stark/config.json`. Should we add optional encryption (e.g., OS keychain integration via `keytar` or `secret-tool`) in a future iteration? Current plan defers this to a follow-up.
- [ ] **Angel One password storage** -- Similar to TOTP seed, the Angel One password needs to be stored for auto-auth. Same security considerations. Both are deferred to the same encryption follow-up.

### OPEN -- Platform & Infrastructure

- [ ] **WSL2 fs.watch reliability** -- Bun's `fs.watch()` may not reliably detect changes on Windows-mounted paths (`/mnt/c/...`) from within WSL2. If the user's TradingView export directory is on the Windows filesystem, polling fallback may be needed. Needs empirical testing during implementation.
- [ ] **Angel One refresh token behavior** -- The current `isAuthenticated()` check is date-based (same calendar day = valid). Does Angel One support silent token refresh via the refresh token, or is a full TOTP re-auth always required? This affects whether we need TOTP generation at all for mid-day session recovery.
- [ ] **Daemon process management** -- For v1, the daemon forks itself into background. Should we provide a systemd unit file or PM2 ecosystem config as an optional install step for production reliability?
- [ ] **Notification sound** -- The config includes `notifications.sound` but `notify-send` does not directly support sound. Should we use `paplay`/`aplay` to play a sound file, or rely on the desktop environment's notification sound settings?

### OPEN -- Behavior

- [ ] **Multiple CSV detection** -- If the user drops multiple CSVs at once (e.g., separate Priority 0 and Priority 1 exports), should the watcher batch them into a single import+scoring run, or process them sequentially? Current plan processes sequentially with debouncing.
- [ ] **EM thresholds in automation context** -- Are the EM thresholds (25/15/12/9.5) validated for automated use, or do they assume human judgment in borderline cases? Automation will apply them mechanically.

## stark-intelligent-automation - 2026-03-07

### OPEN -- LLM & API

- [ ] **Gemini model selection** -- Which Gemini model for OHLCV analysis: gemini-2.0-flash (faster, cheaper) vs gemini-2.0-pro (more accurate)? Affects LLM cost per scoring session and response quality for linearity/AOI/pivot-cutter assessment.
- [ ] **Perplexity model selection** -- Perplexity offers `sonar` (fast) and `sonar-pro` (deeper research). Which to default to for EP catalyst research? Affects research quality vs cost.
- [ ] **LLM cost budget per session** -- A 20-stock evening run with 3 LLM factors each = ~60 Gemini calls + 20 Perplexity calls. Should there be a daily/session cost cap beyond caching? Need to confirm acceptable cost per run.
- [ ] **LLM prompt versioning** -- When LLM prompts are improved (e.g., better linearity assessment wording), cached responses from old prompts become stale. Should the cache key include a prompt version hash, or is TTL-based invalidation sufficient?

### OPEN -- Security

- [ ] **TOTP secret storage security** -- The plan stores `totpSecret` in `~/.stark/config.json` as plaintext. Should this use OS keychain (keytar/secret-tool) or file-level encryption? Plaintext is simpler but less secure. Affects Step 1 (SessionManager).
- [ ] **Angel One password for auto-auth** -- Full auto-auth requires storing the Angel One password alongside the TOTP secret. Same security considerations as TOTP secret storage.

### OPEN -- Data & Scoring

- [ ] **75-minute intraday bars for LLM factors** -- Some factors (AOI, pivot cutter) might produce better results with 75-minute bars in addition to daily. Should `FactorInput` include an optional `intradayBars` field, or is daily-only sufficient for initial implementation?
- [ ] **Broker portfolio sync API** -- Step 5 stubs `stark import --broker` for fetching positions from Angel One portfolio. The Angel One Smart API may require additional endpoints (portfolio/holdings) not currently implemented in `AngelOneProvider`. Needs API documentation review before implementation.
- [ ] **Review command naming** -- With LLM scoring all 13 factors, the `review` command becomes override-only. Should it be renamed to `stark override` for clarity, or keep `stark review` for backward compatibility?
- [ ] **LLM factor batching** -- Should linearity, pivot-cutter, and AOI be sent to Gemini as a single prompt (1 API call per stock, lower cost) or as 3 separate prompts (cleaner separation, easier caching per factor)? Single prompt is ~3x cheaper but harder to cache granularly.

## llm-mandatory (REVISED: Claude-Primary Opt-In) - 2026-03-08

### RESOLVED (by corrected user intent)

- [x] Should `loadConfig()` throw immediately? -- **RESOLVED: NO. LLM is opt-in. No startup validation throws. App works fully without any keys.**
- [x] Should both `geminiKey` AND `perplexityKey` be required? -- **RESOLVED: Neither is required. All three keys (anthropicKey, geminiKey, perplexityKey) are optional. Claude is primary analysis, Gemini is fallback, Perplexity is for research.**
- [x] Should factor `try/catch` blocks re-throw? -- **RESOLVED: No re-throw. Factors catch LLM errors, set `degraded: true`, and return algorithmic fallback. This is already the existing pattern.**
- [x] Should registry descriptions say "optional Gemini"? -- **RESOLVED: Update to say "optional Claude/Gemini" since Claude is now primary and Gemini is fallback. Both remain optional.**
- [x] Should `config.json` include placeholder values? -- **RESOLVED: No. Default config omits `llm` block entirely (it is optional). `stark setup` wizard handles key configuration.**

### OPEN

- [ ] **Claude model selection** -- Plan specifies `claude-sonnet-4-20250514`. Should this be configurable in `LLMConfig` (e.g., `anthropicModel?: string`) or hardcoded? Hardcoded is simpler but less flexible if user wants to try `claude-haiku-4-20250514` for lower cost.
- [ ] **Anthropic API rate limits** -- Claude API has rate limits that differ by plan tier. A 20-stock evening run with 3 LLM factors = ~60 analysis calls. Need to confirm the user's Anthropic plan can handle this throughput without hitting rate limits.
- [ ] **Remove `enabled: boolean` from LLMConfig?** -- The `enabled` toggle is redundant if presence of keys determines enablement. However, removing it is a config schema breaking change for existing users who have `"enabled": true` in their config.json. Should we keep it for backward compat and just ignore it, or remove it and handle missing field gracefully in `loadConfig()`?
- [ ] **Perplexity model upgrade** -- Current code uses `sonar` model. User mentioned Perplexity Finance. Should we upgrade to `sonar-pro` for deeper financial research, or keep `sonar` for cost/speed? Could also be configurable.

## plan-pending-parallel - 2026-03-11

### OPEN -- Parallel Execution

- [ ] **evening.ts / morning.ts merge conflict resolution** -- MBI adds business logic (fetch steps), Logging adds state transition wrappers. Both modify the same files. Plan assumes additive changes to different sections, but if commands are short/simple, changes may overlap. Agents should add changes at clearly separated insertion points (MBI: new function calls, Logging: wrapper log statements around existing calls) to minimize merge friction.
- [ ] **Test execution environment across worktrees** -- Project convention requires copying files from `/mnt/d/` to `/mnt/c/` before running tests. Each worktree at `../SteveTrading-{name}` is still on `/mnt/d/`. Need to verify the copy-and-test workflow works for worktree paths, or if each worktree needs its own test mirror on `/mnt/c/`.
- [x] **Intraday Seam 2 (OHLCVInterval) location** -- **RESOLVED: `OHLCVInterval` is defined in `packages/core/src/models/intervals.ts` and already includes `'1m' | '5m' | '15m' | '75m' | '1d' | '1w' | '1M'`. Seam 2 is COMPLETE. No work needed.**
- [x] **Intraday Seam 6 (analytics filter) timing** -- **RESOLVED: Add a TODO comment in `models/trade.ts` pointing to Phase 3. No code changes until performance analytics are built.**

## plan-mbi-worktree - 2026-03-11

### OPEN -- Implementation

- [ ] **Chartink dashboard accessibility** -- Does Chartink dashboard 291317 require login or serve data anonymously? If login-walled, the Chartink scraper should be stubbed (always throw) and the breadth_only fallback becomes the effective secondary. This must be investigated before or during Step 3 implementation. -- Determines if Chartink fallback is viable or just a stub.
- [ ] **Chartink data format** -- Does Chartink serve dashboard data via XHR/JSON API or inline HTML table? Determines scraper parsing approach. Agent should check browser network tab behavior or attempt a `fetch()` to the dashboard URL during Step 3. -- Affects ~50 lines of parsing logic.
- [ ] **NIFTY 50 constituent identification from instrument master** -- Angel One's instrument master has ~60,000 instruments. How to identify which 50 are NIFTY 50 constituents? The master may not have index membership data. Fallback: hardcoded list of 50 symbols. -- Affects `nifty-constituents.ts` primary source reliability.
- [ ] **BreadthCalculator API cost on first run** -- First run needs 260 days of OHLCV for 50 stocks = 50 API calls at ~1 req/sec = ~1 minute. Is this acceptable as part of the first `stark evening` run, or should bootstrap be a separate `stark setup` step? -- Affects user experience on first use.
- [ ] **mbi-format.ts location** -- The plan places `mbi-format.ts` in `packages/cli/src/utils/` but tests are in `packages/core/tests/`. If the format utility imports CLI-specific types, the test file cannot live in `packages/core/tests/`. Resolution: either move format utility to `packages/core/src/mbi/format.ts` or create a `packages/cli/tests/` directory. -- Affects test file organization.
- [ ] **CLI command registration pattern** -- Need to verify how commands are registered (is there a `packages/cli/bin/stark.ts` router, or is it done differently?). The `stark mbi analyze` command needs to be registered. -- Affects Step 6 integration.

## plan-rpi-telegram - 2026-03-10

### OPEN -- API & Integration

- [ ] **Angel One portfolio/holdings API endpoint** -- `fetchPositions()` needs the correct Angel One Smart API endpoint. Documentation references both `/rest/secure/angelbroking/order/v1/getPosition` and `/portfolio/v1/holdings`. Need to verify which endpoint returns current equity holdings (not intraday positions). Blocks Step 2 implementation for real broker data; MockProvider allows parallel test development.
- [ ] **Angel One refresh token for scheduler** -- The scheduler runs 24/7 and needs re-auth daily. Current `isAuthenticated()` is date-based. Does Angel One support silent refresh via refresh token, or is full TOTP re-auth always required? Affects scheduler's overnight session management.
- [ ] **Gemini model for NLU** -- The NLU layer uses GeminiClient for command parsing. Should it use the same model as scoring (analysis), or a lighter/faster model? NLU parsing is latency-sensitive but low-complexity compared to chart analysis.

### OPEN -- Telegram Bot

- [ ] **Telegram bot token security** -- Bot token is stored in plaintext in `~/.stark/config.json`. Same concern as TOTP seed. Should be tracked alongside the credential encryption follow-up.
- [ ] **Rate limiting on bot responses** -- If someone discovers the bot token, `allowedChatIds` prevents unauthorized access. But should the bot also rate-limit messages from allowed chats to prevent runaway API calls (e.g., rapid-fire scoring requests)?
- [ ] **NLU confidence threshold** -- When Gemini returns a parsed command with low confidence (e.g., 0.3), should the bot ask for clarification or proceed? What confidence threshold triggers a "I'm not sure what you mean" response?

### OPEN -- Deployment

- [ ] **Bun ARM64 on RPi 4 (2020 model)** -- Bun officially supports aarch64 Linux, but empirical verification needed on the specific Pi 4 model. May need to check memory usage under load (scoring + Telegram + scheduler).
- [ ] **USB SSD vs SD card** -- Plan recommends USB SSD for SQLite write durability. User needs to confirm they have or will purchase a USB SSD, or if SD card is acceptable for initial deployment.
- [ ] **Waveshare UPS HAT I2C address** -- UPS monitor script assumes I2C address `0x45`. The actual address depends on the specific UPS HAT revision. Must verify during hardware setup.

### OPEN -- Execution Plan (exec-sprint4-rpi-telegram, 2026-03-12)

- [ ] **`stopPrice` sentinel value convention** -- PortfolioSync passes `stopPrice: 0` to `TradeManager.entry()` for auto-synced trades because `EntryInput.stopPrice` is typed as `number` (not nullable). Is `0` an acceptable sentinel, or should `EntryInput` be updated to allow `undefined`? If `0` is used, `riskAmount` calculates as `entryPrice * shares` which is misleadingly large. -- Affects Step 2 risk calculations for synced trades.
- [ ] **Test mirror rsync for worktrees** -- The NTFS test constraint requires copying from `/mnt/d/` to `/mnt/c/`. For worktrees at `../SteveTrading-sprint4-*`, the rsync target is the same `/mnt/c/Projects/SteveTrading`. Only one worktree can test at a time. Should each worktree have its own NTFS mirror, or is serial testing acceptable? -- Affects parallel agent test execution.
- [ ] **`complete()` no-cache design** -- The execution plan specifies no caching for `LLMService.complete()` since NLU prompts are unique. However, the existing `GeminiClient.analyze()` always caches via `LLMCache`. Should `complete()` bypass the cache entirely (new code path in GeminiClient), or use a separate method that skips cache? -- Affects Step 1 implementation approach.
- [ ] **Root tsconfig.json path alias for @stark/telegram** -- Adding path aliases requires modifying the root `tsconfig.json`. This is a shared config across all packages. Verify no downstream effects on `tsc --noEmit` for existing packages. -- Affects Step 3 package setup.

### PARTIALLY RESOLVED (by this plan superseding stark-automation.md)

- [x] **Daemon process management** -- **RESOLVED: systemd services replace the `stark daemon` approach. No PID file, no tmux. systemd handles restart, boot, and logging.**
- [x] **Notification delivery** -- **RESOLVED: Telegram replaces `notify-send` / PowerShell toast. NotificationChannel interface allows future additions.**
- [x] **File watcher approach** -- **RESOLVED: File watcher dropped entirely. Import via Telegram bot or `stark import` CLI instead.**

## plan-audit-fixes - 2026-03-15

### OPEN -- Auth (Phase 1)

- [ ] **Angel One password storage security** -- Phase 1 adds `password` to `AngelOneConfig` (plaintext in `~/.stark/config.json`). This is consistent with existing `totpSecret` handling, but both should eventually use OS keychain. Tracked as follow-up, not blocking. -- Determines if Phase 1 needs encryption work or defers it.
- [ ] **STARK_MOCK=1 scope** -- Should `STARK_MOCK=1` enable mock mode globally (all commands) or per-command (`--mock` flag)? Global env var is simpler but risks accidental mock scoring in production if the env var leaks into cron/systemd. Per-command flag is safer but more verbose. -- Affects Phase 1 implementation of mock gating.

### OPEN -- Scoring Workflow (Phase 2)

- [ ] **PARTIAL status backward compatibility** -- Existing database rows all have `status='COMPLETE'`. Phase 2 changes batch scoring to produce `'PARTIAL'`. Should a migration update old rows, or treat pre-audit rows as grandfathered COMPLETE? Grandfathering is simpler but means old scores bypass review. -- Affects whether a DB migration is needed in Phase 2.

### RESOLVED -- Scoring Workflow (Phase 2)

- [x] **Semi-discretionary factor classification** -- **RESOLVED (Architect review): `pattern_quality` remains `semi-discretionary` (involves visual chart assessment / VCP recognition). Add to `semiDiscretionaryIds` set in engine.ts. Factor split is 7 algorithmic + 6 semi-discretionary.**

### OPEN -- Sync (Phase 4)

- [ ] **Unresolved trade UX** -- Phase 4 changes portfolio sync to leave trades OPEN when broker positions disappear (instead of fabricating exits). How should the operator resolve these? Options: (a) `stark exit` manually, (b) new `stark reconcile` command that lists unresolved trades and prompts for exit prices, (c) next sync re-checks and auto-resolves if position reappears. -- Affects whether Phase 4 needs a new CLI command or just warnings.
- [ ] **stopPrice sentinel for synced trades** -- PortfolioSync passes `stopPrice: undefined` for auto-synced entries (portfolio-sync.ts:41). This means `riskAmount` is `undefined` and heat calculation treats these trades as zero-risk. Should synced trades be excluded from risk enforcement, or should the operator be prompted to set stops? -- Affects Phase 4 risk enforcement for synced trades.

### OPEN -- Consumers (Phase 5)

- [ ] **Config-driven vs hardcoded focus thresholds** -- config/index.ts defines `ScoreThresholds` and `MaxFocusStocks` but they use different regime key names (bull/cautious/choppy/bear in config vs STRONG_BULL/BULL/CAUTIOUS/CHOPPY/BEAR in runtime). Config is missing `strongBull` entries. Should config be extended or should the mapping handle the mismatch? -- Affects Phase 5 config wiring.

### RESOLVED -- Consumers (Phase 5)

- [x] **Regime-classifier FOCUS_PARAMS duplication** -- **RESOLVED (Architect review): `focus-list.ts` values (5/5/3/2/0) are canonical. Delete `FOCUS_PARAMS` and `getFocusParams()` from regime-classifier.ts entirely. regime-classifier.ts had wrong maxStocks values (12/10/8/5/0).**

## plan-sprint5-telegram-polish - 2026-03-15

### OPEN -- Implementation

- [ ] **Existing executor test mocks** -- If any existing tests in `packages/telegram/tests/` mock the `entry` or `exit` tools, they will need updating to match the new TradeManager-backed signatures. Verify before Phase 1 implementation. -- Could cause test failures if not caught.
- [ ] **Max drawdown percentage when cumulative PnL starts negative** -- If the first trade is a loss, the "peak" starts at 0 (pre-trade). Should drawdown be measured from 0 or from the first positive peak? Plan assumes measurement starts from trade 1's cumulative PnL. -- Affects drawdown accuracy for accounts that start with losses.
- [ ] **Equity curve visualization** -- Advanced stats compute the data needed for an equity curve (cumulative PnL series) but Sprint 5 does not include visualization. Defer to a future sprint with chart rendering (e.g., ASCII chart in Telegram or web UI). -- Follow-up feature.
- [ ] **Kelly percentage practical applicability** -- Kelly % assumes independent, identically distributed bets. Stock trades are neither. Should the Telegram output include a disclaimer, or is the metric useful enough as-is for directional guidance? -- Affects user trust in the metric.
