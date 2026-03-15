# Stark-Trading Implementation Plan (v4)

**Created:** 2026-03-03
**Revised:** 2026-03-04 (v5: added integrated journal, performance validation, scoring evolution, portfolio heat)
**Status:** Ready for implementation
**Scope:** Greenfield build of Stark scoring engine -- CLI-first, UI later
**Developer:** Solo developer, personal trading tool

---

## Context

Stark-Trading automates a mentor's 12-subsection binary scoring system (max 12.5 points, threshold 8+) for Indian stock trading. It complements an existing TradingView + ChartsMaze workflow, reducing evening prep from 2-3 hours to 5-10 minutes. The project has comprehensive documentation (PRD v4.1, System Design v4.1 corrections, Implementation Guide v4.0, Chat Summary) but ZERO source code.

### Key Architectural Facts
- **Runtime:** Bun (CLI for Phase 1-2, UI from Phase 3+)
- **Database:** `bun:sqlite` (native built-in) for CLI phase; adapter for UI phase (Tauri plugin-sql OR better-sqlite3 for web)
- **Primary API:** Angel One Smart API (OHLCV, 75min candles) -- called directly from Bun (no CORS in server-side context)
- **Secondary APIs:** Screener.in (IPO data), NSE public APIs (sector indices), News API (catalysts)
- **LLM Enhancement (optional):** Gemini (EP catalyst classification, VCP explanation), Perplexity (news summaries). Falls back gracefully when unavailable.
- **Two-phase scoring:** Algorithmic (8 factors, 7 fully automated + 1 semi-discretionary) then Discretionary (5 factors, user reviews via CLI prompts in Phase 1-2, GUI in Phase 3+)
- **Scheduling:** User-initiated (primary), OS cron as optional convenience. "Run on open" pattern for UI phase.
- **OHLCV Caching:** Day-1 infrastructure -- cache all fetched data in SQLite, re-fetch only when stale
- **Trade Journal:** Integrated journal with auto-captured score breakdowns, market context, and factor data. Enables performance feedback loop.
- **UI Option:** Tauri desktop app OR web app (Next.js/Vite). Decision deferred to Phase 3. `@stark/core` is portable across all targets.

### Patterns Adopted from virattt/dexter
1. **Scratchpad/Scoring Log:** Append-only JSONL log for every scoring run (transparency + debugging)
2. **Factor Registry:** Centralized registry of scoring factors with metadata (enable/disable, description, data source)
3. **ScoringContext:** Per-batch execution context tracking API calls, cache hits, errors, timing
4. **Progressive Fallback:** Formalized fallback chains for each data source
5. **Soft Limits:** Warnings, never hard blocks (stale data → flag, don't refuse; rate limit → slow down, don't abort)
6. **API Call Tracker:** Track daily API usage, expose in `stark status`

### Doc Discrepancies RESOLVED
1. Implementation Guide v4.0 uses OLD thresholds (4.5/5.0/5.5) -- corrected to 8.0/8.5/9.0 per v4.1
2. Implementation Guide says "all 6 factors" in Week 2 -- corrected to 8 algorithmic factors per v4.1
3. Implementation Guide references `better-sqlite3` -- corrected to `bun:sqlite` (native built-in)
4. Implementation Guide references wrong Thrust Power scoring (graduated) -- corrected to binary (0 or 1)
5. Implementation Guide Week 11 puts CSV import late -- moved to Week 1 (it is the entry point)
6. Focus list generator code uses old thresholds (4.5/5.0/5.5) -- corrected to 8.0/8.5/9.0

---

## Work Objectives

Build a working MVP that handles the core daily loop:
**Import watchlist -> Auto-score algorithmic factors -> Flag discretionary factors -> User reviews -> Generate focus list**

Phase 1-2 delivers this as a **CLI tool** (Bun scripts). Phase 3 adds journal + performance analytics. Phase 4 wraps it in a **UI** (Tauri desktop app OR web app -- decided at Phase 4 start).

**Out of scope:** Order placement, visual chart scanning, cloud sync.

---

## Guardrails

### Must Have
- v4.1 corrected scoring (12 subsections, 12.5 max, 8+ threshold)
- Two-phase workflow with PARTIAL/COMPLETE status
- All 8 algorithmic factors implemented (Pattern Quality is semi-discretionary in v1)
- Discretionary review via CLI prompts (Phase 1-2) or GUI (Phase 3+)
- SQLite local-first storage via `bun:sqlite`
- CSV import as the FIRST feature (it gates everything else)
- OHLCV caching as Day-1 infrastructure
- `@stark/core` as a pure TypeScript package (portable across CLI, Tauri, and web)
- Factor Registry pattern for extensible scoring
- Scoring Log (JSONL) for transparency and debugging
- Progressive fallback for all data sources
- Integrated trade journal with auto-captured score context
- Performance validation after 20+ trades (win rate by score range + factor)
- Scoring evolution after 30+ trades (factor correlation, remove/keep recommendations)

### Must NOT Have
- LLM as a scoring dependency (LLM enhances, never gates scoring)
- Order placement or broker integration beyond data fetching
- Visual chart scanning or pattern discovery UI (TradingView handles this)
- Cloud sync or multi-device -- local-only for MVP
- Weighted scoring or custom factor weights (binary only, per mentor's system)

---

## Project Structure

```
stark-trading/
  packages/
    core/                  # Pure TypeScript -- scoring engine, API clients, DB layer
      src/
        scoring/           # Factor functions + registry + composer
          factors/
            ep-catalyst.ts
            sector-strength.ts
            high-rs.ts
            ipo-recency.ts
            thrust-power.ts
            pivot-location.ts
            pattern-quality.ts
            pivot-level.ts
          registry.ts      # Factor registry (metadata, enable/disable)
          engine.ts        # ScoringEngine composer
          context.ts       # ScoringContext (per-batch metrics)
        api/               # External API clients
          angel-one.ts
          news.ts
          nse.ts
          screener.ts
        llm/               # LLM enhancement layer (optional)
          provider.ts      # Gemini/Perplexity provider abstraction
          catalyst-classifier.ts  # EP catalyst classification via LLM
          news-summarizer.ts      # Overnight news summaries
        db/                # bun:sqlite schema, migrations, queries
          schema.ts
          adapter.ts       # DB adapter interface (bun:sqlite → plugin-sql)
          queries.ts       # All DB access centralized here
        cache/             # OHLCV caching layer
          ohlcv-cache.ts
        log/               # Scoring log (JSONL append-only)
          scoring-log.ts
        journal/           # Trade journal + performance analytics
          journal.ts       # Entry/exit logging with auto-captured context
          positions.ts     # Open position tracking + portfolio heat
          performance.ts   # Win rate by score/factor analysis (20+ trades)
          evolution.ts     # Factor correlation + recommendations (30+ trades)
        models/            # TypeScript interfaces
          score.ts
          stock.ts
          market.ts
          trade.ts         # TradeEntry, TradeExit, Position interfaces
          factor.ts        # RegisteredFactor interface
        utils/
          rate-limiter.ts
          symbol-mapper.ts
          api-tracker.ts   # Daily API call counter
          fallback.ts      # Progressive fallback helper
          trading-calendar.ts  # NSE trading calendar (weekends + holidays)
      tests/
    cli/                   # Bun CLI -- imports core, provides terminal UX
      src/
        commands/
          auth.ts
          import.ts
          score.ts
          review.ts
          focus.ts
          market.ts
          status.ts        # API usage, cache stats, scoring summary
          evening.ts
          morning.ts
          cron.ts
          entry.ts         # Log trade entry (pre-filled from focus list)
          exit.ts          # Log trade exit + P&L calculation
          trades.ts        # View open positions + trade history
          performance.ts   # Performance report + insights
          heat.ts          # Portfolio heat check
        prompts/           # @inquirer/prompts for discretionary review
          review-prompts.ts
      bin/
        stark.ts           # CLI entry point
    app/                   # (Phase 3+) Tauri v2 OR Next.js/Vite web app
      ...
  scripts/
    evening-workflow.ts    # Score all Priority 0 stocks (manual or cron)
    morning-workflow.ts    # Gap check + re-validate (manual or cron)
  bun.lockb
  package.json             # Workspace root
  tsconfig.json
```

---

## LLM Enhancement Layer

### Philosophy: Enhance, Never Gate

Stark works 100% without any LLM. LLMs are an **optional enhancement** that improves accuracy where deterministic approaches are weak. If LLM keys are absent or the service is down, Stark falls back to non-LLM methods automatically.

### Configuration

```json
// ~/.stark/config.json
{
  "llm": {
    "gemini_key": "...",           // Optional. For EP catalyst + VCP explanation
    "perplexity_key": "...",       // Optional. For news summaries. Expires Aug 2026.
    "enabled": true,               // Master switch
    "cache_responses": true,       // Cache LLM responses to reduce API calls
    "cache_ttl_hours": 24          // How long to cache LLM responses
  }
}
```

### Where LLMs Add Value

**1. EP Catalyst Classification (Gemini) — HIGH VALUE**
- **Problem:** Gap >8% detection is easy, but classifying the CAUSE is hard. Keyword matching ("earnings", "approval") has high false-positive rate.
- **With LLM:** Send news headline + stock name + gap % to Gemini. Ask: "Is this gap caused by a genuine catalyst (earnings beat, regulatory approval, major contract, acquisition)? Respond: YES/NO and catalyst type."
- **Fallback without LLM:** Gap-only detection. If gap >8% in last 5 days, EP = 1. No catalyst type classification.
- **Implementation:** `packages/core/src/llm/catalyst-classifier.ts`

**2. Overnight News Summary (Perplexity) — MEDIUM VALUE**
- **Problem:** Morning workflow needs overnight news for focus stocks. Raw News API returns headlines, not actionable summaries.
- **With LLM:** Perplexity search: "Latest news for {RELIANCE} stock India today". Returns concise, sourced summary.
- **Fallback without LLM:** Raw headlines from News API. User reads full articles themselves.
- **Implementation:** `packages/core/src/llm/news-summarizer.ts`
- **Note:** Perplexity access expires Aug 2026. After that, falls back to News API.

**3. VCP Pattern Explanation (Gemini) — LOW-MEDIUM VALUE**
- **Problem:** When VCP heuristic fires, the user sees "VCP suggested: 1.0" but doesn't know WHY.
- **With LLM:** After VCP detection, send the OHLCV summary to Gemini: "Explain why this looks like a VCP pattern. Mention contraction depths, volume trend, and pivot point."
- **Fallback without LLM:** Show numeric data: "3 contractions detected, depths: 12% → 8% → 4%, volume declining"
- **Implementation:** Part of `pattern-quality.ts`, optional enrichment

### Where LLMs Do NOT Help (don't use)
- **Scoring calculations** — deterministic math, LLMs are slower and less reliable
- **Market regime** — Nifty vs MA is a formula
- **Focus list generation** — sorting by score is code
- **Sector strength** — index comparison is arithmetic
- **Natural language queries** — CLI commands are simpler and more reliable for a solo dev

### LLM Response Caching
- Cache LLM responses in SQLite table: `llm_cache(prompt_hash, response, model, created_at)`
- Same EP catalyst question for the same stock + same gap → don't re-query
- TTL: 24 hours (news relevance decays)
- Reduces API costs and latency

---

## Scheduling Strategy

**The laptop is not always on.** Cron jobs are unreliable for this use case.

### Primary mode: User-initiated
- User runs `stark evening` when sitting down for evening prep
- The full workflow takes ~2 minutes
- This is the expected daily usage pattern

### Optional convenience: OS cron or Task Scheduler
- `stark cron --install` sets up crontab entries (8 PM evening, 9 AM morning)
- If the laptop is off when cron fires, the job is simply skipped
- On WSL2: can use Windows Task Scheduler with "run as soon as possible after missed" flag

### Phase 3+ (UI): "Run on open" pattern
- When app launched, checks: "Have I scored today? No → run evening workflow now."
- No background daemon, no persistent service

---

## Task Flow

```
Phase 1: Foundation + Scoring Engine [CLI] (Weeks 1-3)
  |
  v
Phase 2: Discretionary Review + Focus List [CLI] (Weeks 4-5)
  |
  v
Phase 3: Journal + Performance Analytics [CLI] (Weeks 6-7)
  |
  v
Phase 4: UI (Tauri OR Web App) (Weeks 8-9)
```

**Total: 9 weeks.** Phase 1-3 (7 weeks) delivers a fully usable CLI tool with feedback loop. Phase 4 adds GUI but is optional.

---

## Detailed TODOs

### Phase 1: Foundation + Scoring Engine [CLI] (Weeks 1-3)

**Step 1.1: Project Scaffold + Database + Infrastructure**
- Initialize Bun workspace with `packages/core` and `packages/cli`
- Set up TypeScript strict mode, ESLint, Vitest
- Configure `tsconfig.json`: ESNext target, bundler resolution, `@stark/*` path aliases, strict mode
- Create `@stark/core` with `bun:sqlite` database layer (behind adapter interface):
  - `stock_scores` table: all 13 factor columns + `status TEXT` (PARTIAL/COMPLETE) + `reviewed_at` + `data_freshness`
  - `watchlists` + `watchlist_stocks` (with priority 0-3)
  - `ohlcv_cache` table: `symbol, interval, date, open, high, low, close, volume, fetched_at`
  - `market_context`, `sector_money_flow`
  - `focus_lists` + `focus_list_stocks`
  - `llm_cache` table: `prompt_hash, response, model, created_at` (for LLM response caching)
  - `trade_journal` table: `symbol, entry_date, entry_price, shares, stop_price, exit_date, exit_price, exit_reason, pnl, r_multiple, hold_days, score_at_entry, score_breakdown_json, market_regime_at_entry, sector_at_entry, conviction, override_count, status (OPEN/CLOSED)`
  - `positions` table: `symbol, entry_date, entry_price, shares, stop_price, risk_amount, status (OPEN/CLOSED)`
  - `settings`
- Implement OHLCV caching layer:
  - Cache all fetched OHLCV data with `fetched_at` timestamp
  - Only re-fetch if data older than current trading day's close (3:30 PM IST)
  - Stale data fallback when API fails (mark scores as "stale" with `data_freshness` column)
- Implement Scoring Log (`~/.stark/logs/`):
  - Append-only JSONL format
  - Each entry: `{timestamp, session_id, symbol, factor, input_summary, result, reasoning, data_source}`
  - Skip malformed lines on read (defensive, per Dexter pattern)
  - Rotate logs weekly (keep 4 weeks)
- Implement API Call Tracker:
  - Count daily API calls per service (Angel One, NSE, Screener, News, Gemini, Perplexity)
  - Store in memory during session, persist daily totals to DB
  - Expose via `stark status`
- Environment/settings management for API keys (stored in `~/.stark/config.json`)
- Implement NSE Trading Calendar utility (`packages/core/src/utils/trading-calendar.ts`):
  - Hardcoded list of NSE holidays for the current year (source: NSE website, updated annually)
  - `isTradingDay(date: string): boolean` — returns false for weekends (Sat/Sun) and NSE holidays
  - `previousTradingDay(date: string): string` — returns the most recent trading day before the given date (skipping weekends + holidays)
  - `nextTradingDay(date: string): string` — returns the next trading day after the given date
  - `tradingDaysBetween(from: string, to: string): number` — count of trading days in range
  - Used by: EP Catalyst (gap baseline), OHLCV cache staleness check, MBI freshness check, Scoring Log weekly rotation
  - Holiday list stored in `~/.stark/config.json` under `nse_holidays: string[]` (ISO dates), with a bundled default for the current year
- Basic CLI entry point: `stark --help`

**Acceptance Criteria:**
- `stark --help` shows available commands
- SQLite DB created at `~/.stark/stark.db` with all tables including `ohlcv_cache` and `llm_cache`
- Can insert/query a test row programmatically via `@stark/core`
- OHLCV cache correctly stores and retrieves data, skips re-fetch when fresh
- Scoring log writes and reads JSONL entries correctly
- API tracker counts calls per service
- Trading calendar correctly identifies weekends and NSE holidays
- `previousTradingDay()` skips weekends and holidays

**Step 1.2: Angel One API Integration + CSV Import + Fallback Chains**
- Implement Angel One Smart API client in `@stark/core`:
  - Authenticate with TOTP (user authenticates once daily via `stark auth`)
  - Fetch OHLCV daily candles
  - Fetch OHLCV 75min candles
  - All fetched data goes through OHLCV cache layer
- Handle token management:
  - Store session token in `~/.stark/session.json` after daily authentication
  - Token valid for remainder of the trading session
  - If token expires mid-workflow, prompt user to re-authenticate
- Implement rate limiting (1 req/sec queue with backoff)
- Implement Progressive Fallback chains:
  - OHLCV: Angel One live → cached stale data (flag "stale")
  - EP catalyst news: Perplexity → News API → gap-only detection (no news)
  - IPO data: Screener.in → Angel One instrument master listing date
  - Each fallback logged in scoring log with `data_source` field
- Build CSV import: parse TradingView export, validate symbols against Angel One symbol master, fuzzy match
- Map TradingView symbols to Angel One symbol tokens (fetch and cache instrument master)
- Store imported watchlist with priority level
- CLI commands: `stark auth`, `stark import <csv-path>`, `stark status`

**Acceptance Criteria:**
- `stark auth` prompts for TOTP and authenticates with Angel One
- Can fetch 100 days of RELIANCE daily OHLCV (data stored in cache)
- Can fetch 75min candles for a symbol (data stored in cache)
- `stark import watchlist.csv` imports stocks and shows count
- Symbol token mapping works (RELIANCE -> correct Angel One token)
- Rate limiter prevents API throttling
- Second fetch of same data hits cache, not API
- `stark status` shows API call counts, cache hit rate, session validity
- Fallback chain works: when Angel One fails, stale cache used with warning

**Step 1.3: Scoring Engine + Factor Registry**
- Implement Factor Registry in `@stark/core/scoring/registry.ts`:
  ```typescript
  interface RegisteredFactor {
    id: string;                    // "ep_catalyst"
    name: string;                  // "EP Catalyst"
    section: string;               // "X Factor" | "Nature" | "Base Strength" | "Readiness"
    type: 'algorithmic' | 'semi-discretionary' | 'discretionary';
    scoring: 'binary' | 'graduated';  // binary = 0/1, graduated = 0/0.5/1.0
    maxPoints: number;             // 1 or 1.0
    dataSource: string;            // "Angel One OHLCV + News API"
    description: string;           // For CLI/UI display
    guidanceText: string;          // What to look for (for discretionary review)
    enabled: boolean;              // Can be disabled (CEC-3)
    fn: FactorFunction;            // The actual scoring function
  }
  ```
- Register all 13 factors (8 algorithmic + 5 discretionary)
- Dynamic enable/disable from settings (handles CEC-3: disabled TradingView indicators)
- When factors disabled: adjust max score and threshold automatically
- Implement each algorithmic factor as an independent, testable function:
  1. **EP Catalyst (FR-3.1):** gap >8% in last 5 days. Gap = `(day_open - prev_day_close) / prev_day_close × 100`. Previous close sourced from OHLCV cache (the `close` of the prior trading day's daily candle). Must skip non-trading days (weekends/holidays) — use the most recent trading day's close, not calendar-previous day. With LLM (Gemini): classify catalyst type. Without LLM: gap-only detection. Corporate action filter: if Angel One instrument master reports a split/bonus/rights in the gap window, flag as "corporate action gap" and score EP = 0 (not a genuine catalyst).
  2. **Sector Strength (FR-3.2):** stock's sector index vs Nifty 50 today (NSE public API)
  3. **High RS (FR-3.3):** stock % change vs Nifty % change over 60 days, threshold >15%
  4. **IPO Recency (FR-3.4):** listing date < 2 years. Fallback chain: Screener.in → Angel One master.
  5. **Thrust Power (FR-3.5):** max candle range >= 8% in last 60 days. Binary: 0 or 1.
  6. **Pivot Location (FR-3.6):** Minervini base detection + pivot position (0/0.5/1.0). Algorithm: ATR compression method — identify consolidation as a period (20-100 trading days) where the 10-day ATR contracts to ≤50% of the ATR at consolidation start, with price staying within a defined channel (highest high to lowest low range ≤30% of the pre-consolidation swing). Pivot point = the channel high (breakout level). Scoring: price within lower third of base = 0, middle third = 0.5, upper third (near pivot) = 1.0. If no valid base detected (consolidation <20 days or ATR not compressing) = 0.
  7. **Pattern Quality (FR-3.7) -- SEMI-DISCRETIONARY:**
     - VCP heuristic: consolidation 20+ days, contractions <75%, volume decline <=90%, min 3 contractions
     - With LLM (Gemini): explain why it looks like VCP
     - Without LLM: show numeric data (contraction depths, volume trend)
     - IH&S / Cup & Handle: user-only for v1
  8. **Pivot Level Proximity (FR-3.8):** current price within 3% of detected pivot
- Implement ScoringContext for each batch:
  ```typescript
  interface ScoringContext {
    session_id: string;
    started_at: number;
    symbols: string[];
    market_regime?: MarketRegime;
    api_calls: Record<string, number>;  // per service
    cache_hits: number;
    cache_misses: number;
    llm_calls: number;
    errors: { symbol: string; factor: string; error: string }[];
    completed_at?: number;
  }
  ```
- Compose into `ScoringEngine.calculateAlgorithmicScore(symbol, context)` returning partial score with status PARTIAL
- Every factor result logged to Scoring Log with input data, result, reasoning, data source
- Store results in `stock_scores` table
- CLI command: `stark score [--symbol SYMBOL | --all]`

**Acceptance Criteria:**
- Factor registry lists all 13 factors with metadata
- Disabling a factor adjusts max score and threshold
- Each factor function has unit tests with known stock data
- `stark score --symbol RELIANCE` outputs factor breakdown to terminal
- `stark score --all` scores all Priority 0 stocks with rate-limited API calls
- Scores stored in DB with correct breakdown and status = PARTIAL
- Scoring log contains JSONL entries for every factor calculation
- ScoringContext tracks API calls, cache hits, errors per batch
- LLM enhancement works for EP catalyst when Gemini key present
- Without Gemini key, EP falls back to gap-only detection seamlessly
- VCP heuristic produces reasonable results on known patterns

---

### Phase 2: Discretionary Review + Focus List [CLI] (Weeks 4-5)

**Step 2.1: CLI Discretionary Review**
- Build review queue: list stocks with status=PARTIAL that have algorithmic score >= 3 (potential to reach 8+)
- For each stock in review queue, show in terminal:
  - Algorithmic score breakdown (from registry metadata: section, name, result)
  - VCP heuristic suggestion + LLM explanation if available
  - 5 discretionary factor prompts via `@inquirer/prompts`:
    1. Linearity (Y/N) — guidance from registry
    2. NOT Pivot Cutter (Y/N)
    3. AOI (Y/N)
    4. HVE/HVY (Y/N)
    5. 2.5HVQ (Y/N)
  - TradingView deep-link printed to terminal
- On submit: update score to COMPLETE, recalculate total, store `reviewed_at`
- Manual override: any factor can be toggled with reason text (logged in scoring log)
- CLI command: `stark review [--symbol SYMBOL | --next]`

**Acceptance Criteria:**
- `stark review --next` shows the next unreviewed stock with score potential
- Review flow presents all discretionary factors with guidance text from registry
- VCP suggestion shown with LLM explanation when available
- TradingView link printed and openable
- Score transitions from PARTIAL to COMPLETE
- Overrides logged in scoring log with reason

**Step 2.2: Focus List Generation + Market Context**
- Market regime classifier: Nifty 50 vs 50-DMA and 200-DMA + breadth
  - BULL: price > 50-DMA > 200-DMA AND breadth > 60%
  - BEAR: price < 50-DMA < 200-DMA AND breadth < 40%
  - CHOPPY: everything else
- Sector money flow: 11 NSE sectors, STRONG/MODERATE/WEAK
- Focus list generator:
  - Filter: status=COMPLETE AND total_score >= threshold (8.0 bull / 8.5 choppy / 9.0 bear)
  - If factors disabled (CEC-3): threshold adjusted proportionally — `adjusted_threshold = base_threshold × (adjusted_max_score / 12.5)`. Example: if 2 binary factors disabled (max drops from 12.5 to 10.5), BULL threshold = 8.0 × (10.5/12.5) = 6.72, rounded to 6.5. Formula: `Math.round(base × (adjMax / 12.5) * 2) / 2` (round to nearest 0.5).
  - Prioritize: STRONG sector stocks first, then by score descending
  - Limit: top 3-5 stocks
  - Pre-calculate position sizes (entry at pivot, stop at base low, configurable risk)
- CLI commands: `stark market` (regime + sectors), `stark focus` (generate focus list)

**Acceptance Criteria:**
- `stark market` correctly classifies current market regime and sector strengths
- `stark focus` generates focus list with only COMPLETE scores above threshold
- Threshold auto-adjusts when factors are disabled
- Position sizes calculated and displayed
- Focus list output is clean, actionable terminal table

**Step 2.3: Evening & Morning Workflow Scripts**
- Evening workflow (`stark evening`):
  1. Check for valid Angel One session (if expired, exit with "run `stark auth` first")
  2. Create ScoringContext for this batch
  3. Fetch market data for all Priority 0 stocks (through OHLCV cache)
  4. Run algorithmic scoring (batch, rate-limited)
  5. Classify market regime + sector flow
  6. Generate partial focus list from already-COMPLETE scores
  7. Print summary + ScoringContext stats (API calls, cache hits, errors)
  8. If Perplexity available: fetch overnight news summaries for focus stocks
- Morning workflow (`stark morning`):
  1. Check overnight gaps (>3%) for focus list stocks
  2. Re-validate setups (price below base = invalidated)
  3. If Perplexity available: summarize overnight news
  4. Print changes, notify only if changes detected
- Optional: `stark cron --install` / `stark cron --remove`

**Acceptance Criteria:**
- `stark evening` runs and scores all Priority 0 stocks, shows batch stats
- If session expired, exits cleanly with auth prompt
- `stark morning` detects overnight gaps and invalidated setups
- News summaries displayed when Perplexity key present
- Without Perplexity, raw headlines shown (or skipped gracefully)
- Workflows handle API errors via fallback chains

---

### Phase 3: Journal + Performance Analytics [CLI] (Weeks 6-7)

**Step 3.1: Integrated Trade Journal**
- Trade entry logging (`stark entry <SYMBOL>`):
  - Auto-fill from focus list: score breakdown (all 13 factors), market regime, sector strength, planned entry/stop/size
  - User inputs: actual entry price, actual shares, conviction (High/Medium/Low)
  - Auto-capture: override count (how many factors user overrode), data freshness at scoring time
  - Calculate risk amount: (entry - stop) × shares
  - Store in `trade_journal` + `positions` tables
- Trade exit logging (`stark exit <SYMBOL>`):
  - User inputs: exit price, exit reason (Stopped/Target/Discretion/Invalidated)
  - Auto-calculate: P&L, R-multiple (P&L ÷ risk), hold days
  - Close position in `positions` table
- Trade list view (`stark trades [--open | --closed | --all]`):
  - Show open positions with current P&L (if market data available)
  - Show closed trades with outcomes
  - Filter by date range, score range, win/loss
- Manual score override tracking:
  - When user overrides a factor during review, the override reason is already in scoring log
  - At entry time, `override_count` captures how many factors were overridden
  - Performance analytics can compare: "trades with overrides vs without"

**Acceptance Criteria:**
- `stark entry RELIANCE` pre-fills score, regime, sector from latest scoring data
- Entry takes <30 seconds (most fields auto-filled)
- `stark exit RELIANCE` calculates P&L and R-multiple correctly
- `stark trades --open` shows current positions with risk amounts
- Score breakdown stored as JSON snapshot (survives re-scoring)

**Step 3.2: Portfolio Heat Tracking**
- Calculate portfolio heat: sum of risk across all open positions
  - Risk per position = (entry_price - stop_price) × shares
  - Portfolio heat = total risk ÷ total capital (configurable, default ₹5,00,000)
  - Display as percentage
- Warning at 6% heat, alert at 8% heat
- Show in `stark heat` and `stark status`
- When heat > 8%: warn during `stark entry` ("Portfolio heat at 9.2% — exceeds 8% limit")
  - Soft limit: warn, don't block (per Dexter pattern)

**Acceptance Criteria:**
- `stark heat` shows current portfolio heat with per-position breakdown
- Warning displayed when opening a new trade would exceed 8%
- Heat recalculates when positions are opened/closed

**Step 3.3: Performance Validation (requires 20+ closed trades)**
- Win rate analysis (`stark performance`):
  - Overall: total trades, wins, losses, win rate, total P&L, avg R-multiple
  - By score range: 10-12.5, 8-10, <8 — win rate for each
  - By individual factor: for each of 13 factors, compare win rate when factor = 1 vs factor = 0
  - By market regime: win rate in BULL vs CHOPPY vs BEAR
  - By sector strength: win rate in STRONG vs MODERATE vs WEAK sectors
- Override accuracy:
  - Compare trades where user overrode factors vs trades with pure algorithmic scores
  - "Your overrides improved outcomes X% of the time"
- Auto-generate insights (only when statistically meaningful, 20+ trades):
  - "Your edge: 10+ scores win 85%. Focus here."
  - "EP factor adds +30% win rate when present"
  - "Your Linearity assessment: 82% accurate"
  - "Weak signal: RS factor shows no correlation (55% vs 54%)"
- Guard: display "Need X more trades for meaningful insights" when insufficient data
  - Basic stats (win rate, P&L): available from trade 1
  - Factor analysis: requires 20+ closed trades
  - Scoring evolution: requires 30+ closed trades

**Acceptance Criteria:**
- `stark performance` shows comprehensive breakdown after 20+ trades
- With <20 trades, shows basic stats only with "need more data" message
- Factor-level win rate comparison is correct (verified with mock data)
- Insights are generated only when edge is statistically meaningful (>10% difference)

**Step 3.4: Scoring Evolution (requires 30+ closed trades)**
- Factor correlation analysis (`stark evolve`):
  - For each of 13 factors: calculate edge = win_rate_when_present - win_rate_when_absent
  - Rank factors by predictive power for THIS user
  - Categorize:
    - **Strong edge (>20%):** "Keep — high predictive value"
    - **Moderate edge (10-20%):** "Keep — contributing"
    - **No edge (<10%):** "Consider removing — no correlation with your wins"
    - **Negative edge (<0%):** "Investigate — negatively correlated"
- Discretionary accuracy tracking:
  - For each discretionary factor (Linearity, Pivot Cutter, AOI, HVE/HVY, HVQ):
    - When user said YES → win rate
    - When user said NO → win rate
    - "Your Linearity assessment: 82% accurate"
  - Builds confidence in user's own judgment over time
- Recommendations (suggestions, never auto-applied):
  - "Remove RS: no correlation with your wins (55% vs 54%)"
  - "Your Linearity calls are highly accurate (85%) — trust your judgment"
  - "Consider: EP catalyst is your strongest edge (+32%)"
- Guard: requires 30+ closed trades. Below that: "Scoring evolution requires 30+ trades for reliable recommendations."

**Acceptance Criteria:**
- `stark evolve` shows factor ranking by predictive power after 30+ trades
- Discretionary accuracy percentages are correct
- Recommendations are generated with supporting data
- With <30 trades, shows "need more data" message

---

### Phase 4: UI (Weeks 8-9) — Tauri OR Web App

**Decision point at Phase 4 start:** Choose UI framework based on Phase 1-3 experience.

#### Option A: Tauri Desktop App
- Tauri v2 + React + TailwindCSS
- `@tauri-apps/plugin-sql` for SQLite, `@tauri-apps/plugin-http` for API calls
- Pros: native desktop, small binary, system tray
- Cons: Rust learning curve, plugin ecosystem

#### Option B: Web App (local server)
- Next.js or Vite + React + TailwindCSS
- Bun as the server runtime (same as CLI)
- `better-sqlite3` or `bun:sqlite` for SQLite (server-side)
- Runs at `localhost:3000`, opened in browser
- Pros: zero Rust, same runtime, deployable to VPS later
- Cons: browser tab instead of native app

**Both options import `@stark/core` unchanged.**

**UI Features (regardless of framework):**
- Dashboard: market regime, sector heatmap, focus list with trade plans, portfolio heat gauge
- Watchlist view: imported stocks grouped by priority
- Score detail: all 13 factors with pass/fail breakdown (from registry metadata)
- Discretionary review: checkboxes, TradingView deep-link, LLM explanations
- Trade journal: entry form (pre-filled from focus list), exit form, trade history with filters
- Performance dashboard: win rate charts by score range, factor heatmap, insight cards
- Scoring evolution: factor ranking table, discretionary accuracy, recommendations
- Portfolio heat: visual gauge, per-position breakdown, warning indicators
- Settings: API keys (Angel One, Gemini, Perplexity), risk amount, total capital, threshold override, factor enable/disable
- Scoring log viewer: browse JSONL entries, filter by symbol/factor/date
- Status dashboard: API usage, cache stats, LLM usage
- "Run on open" pattern: check if scored today, if not → run evening workflow

**Acceptance Criteria:**
- App launches and displays data from `~/.stark/stark.db`
- All views work with existing CLI-generated data
- Discretionary review works via GUI (PARTIAL → COMPLETE)
- API calls work without CORS issues
- LLM settings configurable from UI
- Settings persist to `~/.stark/config.json`

---

## Edge Cases to Handle

From PRD section 5 (implemented during Phase 2-4):
- **CEC-1:** Unreviewed stocks → "X stocks MIGHT qualify if reviewed"
- **CEC-3:** Disabled TradingView indicators → registry adjusts max score + threshold automatically
- **CEC-4:** Insufficient data for IPOs → flag "Limited data, scores may be incomplete"
- **CEC-5:** Multiple patterns → still 1 point (binary), but show all detected
- **CEC-6:** Base outside 2.5-20 weeks → Pivot Location = 0, flag warning
- **CEC-7:** Angel One last 2 candles → mitigated by running after 3:30 PM close
- **CEC-8:** Corporate actions → flag for manual review
- **CEC-9:** Insufficient trades for analysis → show basic stats only, hide factor analysis until 20+, hide evolution until 30+
- **CEC-10:** High override rate (>80%) → "You're overriding most scores. Consider adjusting settings or relying more on discretion."

---

## Success Criteria (Overall)

1. **End-to-end daily loop:** Import CSV → score → review → focus list in under 2 minutes
2. **Scoring matches mentor's system:** 12 subsections, binary, 12.5 max, 8+ threshold, two-phase workflow
3. **Evening workflow works:** `stark evening` scores all Priority 0 stocks with batch stats
4. **Core is portable:** `@stark/core` works in CLI, Tauri, and web without changes
5. **User trusts the scores:** Factor breakdown is transparent via scoring log + registry metadata
6. **LLM enhances when available:** EP catalyst classification and news summaries improve accuracy, but scoring works 100% without them
7. **Trade logging is frictionless:** Entry in <30 seconds with auto-filled context from scoring data
8. **Feedback loop closes:** After 20+ trades, user knows which factors predict THEIR wins. After 30+, system recommends adjustments.
9. **Portfolio risk visible:** Heat percentage always visible, warning before over-exposure

---

## RALPLAN-DR Summary

### Guiding Principles
1. **MVP-first, iterate later:** Get the daily scoring loop working end-to-end before UI.
2. **Data correctness over UI polish:** The scoring engine IS the product.
3. **Local-first, no complexity tax:** SQLite + CLI. No servers, no auth, no deployment.
4. **Complement, don't replace:** Deep-link to TradingView and ChartsMaze.
5. **Score transparency:** Every score fully explainable via scoring log and factor registry. No black boxes.
6. **Enhance, never gate:** LLMs improve accuracy but never block scoring. Always falls back gracefully.
7. **Close the feedback loop:** The integrated journal connects scoring to outcomes. Without it, the scoring system is a black box that never learns.

### Decision Drivers
1. **Solo developer velocity:** CLI-first eliminates Tauri/Rust/CORS from the critical path.
2. **Scoring accuracy:** Factor registry + scoring log + LLM classification combine for trustworthy scores.
3. **API reliability:** OHLCV caching, progressive fallback chains, and LLM response caching from Day 1.

### Architecture
- `@stark/core` = pure TypeScript package (scoring, API, DB, LLM, journal, performance)
- `@stark/cli` = Bun CLI (Phase 1-3 daily driver)
- `@stark/app` = Tauri OR web app (Phase 4, decision deferred)
- Zero throwaway work — core is shared across all targets

---

## TOTP Authentication Strategy

**Option (b): User authenticates once daily**

`stark auth` prompts for Angel One credentials + TOTP, stores session token in `~/.stark/session.json`. Evening workflow checks validity before proceeding.

---

## VCP Algorithm Specification (v1 Heuristic)

Semi-discretionary: Stark suggests, user confirms during review.

1. **Consolidation range:** 20+ trading days within a defined high-low band
2. **Contractions:** Each successive swing range < 75% of previous
3. **Volume decline:** Each contraction's avg volume <= 90% of previous
4. **Minimum:** 3 contracting swings (3-touch pattern)
5. **Scoring:** >= 3 contractions + volume decline → suggest 1.0; partial → suggest 0.5; none → 0
6. **IH&S / Cup & Handle:** User-only in v1
7. **LLM enrichment (optional):** When Gemini available, generate plain-language explanation of why pattern was detected

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation | Status |
|------|-----------|--------|------------|--------|
| Angel One rate limits block batch scoring | HIGH | HIGH | OHLCV caching Day-1. Stale fallback. 1 req/sec throttle. API tracker monitors usage. | MITIGATED |
| VCP detection inaccurate | MEDIUM | MEDIUM | Semi-discretionary: suggest + user confirms. Scoring log tracks all detections. | MITIGATED |
| Angel One TOTP fragile for automation | HIGH | MEDIUM | User authenticates once daily. Token stored. Workflow checks validity. | MITIGATED |
| EP catalyst classification inaccurate (keyword matching) | MEDIUM | MEDIUM | LLM (Gemini) classifies catalysts when available. Fallback: gap-only. Progressive fallback chain. | MITIGATED |
| Perplexity access expires Aug 2026 | CERTAIN | LOW | Falls back to News API headlines. News summaries are nice-to-have, not critical. | ACCEPTED |
| LLM API costs | LOW | LOW | Response caching (24h TTL). Only used for EP catalyst + news. ~10-20 calls/day max. | MITIGATED |
| CORS in Tauri webview | HIGH | HIGH | **ELIMINATED for CLI.** Phase 3 uses plugin-http or web server. | ELIMINATED |
| SQLite driver incompatibility | HIGH | HIGH | **ELIMINATED.** bun:sqlite for CLI. Adapter interface for Phase 3. | ELIMINATED |
| Screener.in blocks scraping | MEDIUM | LOW | Fallback: Angel One instrument master. Progressive fallback chain. | ACCEPTED |
| 75min candles unavailable | LOW | MEDIUM | Daily-only for v1. Add 75min when confirmed. | ACCEPTED |
| Solo dev burnout | MEDIUM | HIGH | Phase 1-3 (7 weeks) = usable CLI with feedback loop. Phase 4 optional. | ACCEPTED |

---

## Timeline Summary

| Phase | Weeks | Deliverable | Runtime |
|-------|-------|-------------|---------|
| 1: Foundation + Scoring | 1-3 | Scaffold, DB, OHLCV cache, scoring log, API tracker, factor registry, LLM layer, CSV import, 8 factors | Bun CLI |
| 2: Review + Focus List | 4-5 | Discretionary review, focus list, market context, evening/morning workflows | Bun CLI |
| 3: Journal + Performance | 6-7 | Trade journal, portfolio heat, performance validation (20+ trades), scoring evolution (30+ trades) | Bun CLI |
| 4: UI | 8-9 | Tauri desktop app OR web app with all views + journal + performance dashboards | Tauri/Web |

**9 weeks total.** Phase 1-3 (7 weeks) delivers a fully usable CLI tool with complete feedback loop. Phase 4 adds GUI but is optional.
