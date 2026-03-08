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
