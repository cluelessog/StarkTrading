# PRD: Stark-Trading — CLI-First Stock Scoring System

**Created:** 2026-03-04
**Status:** Ready for ralph execution
**Owner:** Solo developer (personal trading tool)
**Runtime:** Bun + TypeScript + bun:sqlite
**Source Plans:** Master (v5), MBI (v5.1), Logging (v2), Intraday Extensibility (v1), OpenAlgo Feasibility (v2)

---

## Problem Statement

The user spends 2-3 hours each evening manually scoring 30-50 Indian stocks using a mentor's 12-subsection binary scoring system (max 13 points, threshold 8+). This involves cross-referencing TradingView charts, Angel One data, news sources, and market breadth indicators. The process is tedious, error-prone, and prevents the user from focusing on the discretionary judgment that actually matters.

**Goal:** Reduce evening prep from 2-3 hours to 5-10 minutes by automating the 8 algorithmic factors and streamlining the 5 discretionary factors into a review queue.

---

## Goals

1. Automate the daily scoring loop: Import watchlist → Auto-score → Review → Focus list
2. Integrate MBI/EM market regime classification (5-tier) to gate focus list generation
3. Track trades with auto-captured score context for performance feedback
4. Build a scoring evolution system that tells the user which factors predict THEIR wins
5. Keep architecture extensible for future intraday trading (seams, not features)

## Non-Goals

- Order placement or broker integration beyond data fetching
- Visual chart scanning or pattern discovery (TradingView handles this)
- Cloud sync or multi-device support
- Weighted scoring or custom factor weights (binary only, per mentor's system)
- Intraday features in Phase 1-3 (only architectural seams)
- OpenAlgo integration in Phase 1-3 (DataProvider interface as seam only)

---

## Technical Constraints

- **Runtime:** Bun (not Node.js)
- **Database:** `bun:sqlite` (native built-in), behind adapter interface
- **Package manager:** Bun
- **Testing:** Vitest
- **Linting:** ESLint + TypeScript strict mode
- **API:** Angel One Smart API (direct HTTP, behind DataProvider interface)
- **LLM:** Optional Gemini + Perplexity (enhance, never gate scoring)
- **Data storage:** `~/.stark/stark.db` (SQLite), `~/.stark/config.json` (settings), `~/.stark/logs/` (JSONL)
- **Monorepo:** `packages/core` (pure TS) + `packages/cli` (Bun CLI)
- **No Python, no servers, no Docker** — single-process CLI tool

---

## Project Structure

```
stark-trading/
  packages/
    core/                  # Pure TypeScript — scoring engine, API clients, DB layer
      src/
        scoring/           # Factor functions + registry + composer
          factors/         # 8 algorithmic factor files
          registry.ts      # Factor registry (metadata, enable/disable)
          engine.ts        # ScoringEngine composer
          context.ts       # ScoringContext (per-batch metrics)
        api/               # External API clients
          data-provider.ts # DataProvider interface + DataProviderError
          angel-one.ts     # AngelOneProvider implements DataProvider
          mbi-sheet.ts     # Google Sheet gviz CSV client (EM + breadth)
          chartink.ts      # Chartink scraper (raw breadth fallback)
          news.ts          # News API client
          nse.ts           # NSE public API client
          screener.ts      # Screener.in client
        llm/               # Optional LLM enhancement layer
          provider.ts
          catalyst-classifier.ts
          news-summarizer.ts
        db/                # bun:sqlite schema, migrations, queries
          schema.ts
          adapter.ts
          queries.ts
        mbi/               # Market Breadth Indicator
          regime-classifier.ts
          fallback-classifier.ts
          data-manager.ts
        cache/
          ohlcv-cache.ts
        log/
          scoring-log.ts
          logger.ts        # Structured JSONL logger
        journal/
          journal.ts
          positions.ts
          performance.ts
          evolution.ts
        models/            # TypeScript interfaces
        utils/
          rate-limiter.ts
          symbol-mapper.ts
          api-tracker.ts
          fallback.ts
          trading-calendar.ts  # NSE trading calendar (weekends + holidays)
      tests/
    cli/                   # Bun CLI — imports core, provides terminal UX
      src/
        commands/          # stark auth, import, score, review, focus, market, evening, morning, etc.
        prompts/           # @inquirer/prompts for discretionary review
      bin/
        stark.ts           # CLI entry point
  scripts/
  package.json             # Workspace root
  tsconfig.json
```

---

## Implementation Phases

### Phase 1: Foundation + Scoring Engine (Weeks 1-3)

#### Step 1.1: Project Scaffold + Database + Infrastructure

**Tasks:**
- [ ] Initialize Bun workspace monorepo with `packages/core` and `packages/cli`
- [ ] Configure TypeScript strict mode, ESLint, Vitest, `@stark/*` path aliases
- [ ] Create SQLite schema with all tables behind adapter interface:
  - `stock_scores` (13 factor columns, status PARTIAL/COMPLETE, reviewed_at, data_freshness)
  - `watchlists` + `watchlist_stocks` (priority 0-3)
  - `ohlcv_cache` (symbol, interval, date, OHLCV, fetched_at)
  - `market_context`, `sector_money_flow`
  - `focus_lists` + `focus_list_stocks`
  - `llm_cache` (prompt_hash, response, model, created_at)
  - `trade_journal` (with `trade_type TEXT DEFAULT 'swing'` — intraday seam 1)
  - `positions` (with `trade_type TEXT DEFAULT 'swing'` — intraday seam 1)
  - `mbi_daily` (with `PRIMARY KEY (date, captured_at)` — intraday seam 7)
  - `settings`
- [ ] Implement structured logger (JSONL format, console + file transport, log levels, correlation IDs, weekly rotation)
- [ ] Implement OHLCV caching layer (cache with fetched_at, re-fetch only when stale past 3:30 PM IST)
- [ ] Implement Scoring Log (append-only JSONL, per-factor entries, defensive read)
- [ ] Implement API Call Tracker (daily counts per service, persist to DB)
- [ ] Create `~/.stark/config.json` settings management
- [ ] Implement NSE Trading Calendar (`packages/core/src/utils/trading-calendar.ts`):
  - `isTradingDay(date)`, `previousTradingDay(date)`, `nextTradingDay(date)`, `tradingDaysBetween(from, to)`
  - Hardcoded NSE holidays for current year (in config under `nse_holidays: string[]`)
  - Used by: EP Catalyst gap baseline, OHLCV staleness, MBI freshness, scoring log rotation
- [ ] Basic CLI entry point: `stark --help`

**Acceptance Criteria:**
- [ ] `stark --help` shows available commands
- [ ] SQLite DB created at `~/.stark/stark.db` with all tables
- [ ] Can insert/query test rows via `@stark/core`
- [ ] OHLCV cache stores/retrieves data, skips re-fetch when fresh
- [ ] Scoring log writes and reads JSONL entries correctly
- [ ] Logger writes structured JSONL to `~/.stark/logs/stark-YYYY-MM-DD.jsonl`
- [ ] Logger outputs to console with configurable verbosity (--verbose flag)
- [ ] API tracker counts calls per service
- [ ] `trade_journal` and `positions` tables have `trade_type` column
- [ ] Trading calendar correctly identifies weekends and NSE holidays
- [ ] `previousTradingDay()` skips weekends and holidays

#### Step 1.2: Angel One API + DataProvider + CSV Import

**Tasks:**
- [ ] Define `DataProvider` interface in `packages/core/src/api/data-provider.ts`:
  - `DataProviderError` with kind discriminant (auth_expired/rate_limited/data_unavailable/network_error)
  - Methods: authenticate, isAuthenticated, dispose, fetchOHLCV, fetchQuote, fetchQuotes, searchSymbol, getInstrumentMaster
  - Note: interface is a draft — refine based on actual Angel One API behavior
- [ ] Implement `AngelOneProvider implements DataProvider`:
  - TOTP authentication (`stark auth`)
  - Fetch OHLCV daily + 75min candles
  - All data through OHLCV cache layer
  - Token management in `~/.stark/session.json`
- [ ] Implement `MockProvider implements DataProvider` (fixture data for testing)
- [ ] Implement rate limiting (1 req/sec queue with exponential backoff)
- [ ] Implement progressive fallback chains:
  - OHLCV: Angel One live → cached stale data (flag "stale")
  - EP catalyst: Perplexity → News API → gap-only
  - IPO data: Screener.in → Angel One instrument master
  - Fallback logged with `data_source` field + DataProviderError kind
- [ ] Build CSV import (parse TradingView export, validate symbols, fuzzy match)
- [ ] Map TradingView symbols to Angel One tokens (fetch + cache instrument master)
- [ ] Widen `OHLCVInterval` type to include sub-daily intervals (intraday seam 2)
- [ ] CLI commands: `stark auth`, `stark import <csv-path>`, `stark status`

**Acceptance Criteria:**
- [ ] `stark auth` authenticates with Angel One via TOTP
- [ ] Can fetch 100 days of RELIANCE daily OHLCV (cached)
- [ ] Can fetch 75min candles (cached)
- [ ] `stark import watchlist.csv` imports and shows count
- [ ] Symbol mapping works (RELIANCE → correct token)
- [ ] Rate limiter prevents throttling
- [ ] Second fetch hits cache, not API
- [ ] `stark status` shows API counts, cache hit rate, session validity
- [ ] Fallback chain works with DataProviderError discrimination
- [ ] MockProvider enables full scoring tests without credentials
- [ ] `OHLCVInterval` accepts '1m' | '5m' | '15m' | '75m' | '1d' | '1w' | '1M'

#### Step 1.3: Scoring Engine + Factor Registry

**Tasks:**
- [ ] Implement Factor Registry with `RegisteredFactor` interface (id, name, section, type, scoring, maxPoints, dataSource, description, guidanceText, enabled, fn)
- [ ] Register all 13 factors (8 algorithmic + 5 discretionary placeholders)
- [ ] Dynamic enable/disable with auto-adjusted max score + threshold
- [ ] Implement 8 algorithmic factors as independent testable functions:
  1. EP Catalyst — gap >8% in 5 days. Gap = `(open - previousTradingDay close) / prev close × 100`. Uses trading calendar to skip weekends/holidays. Corporate action filter: splits/bonuses in gap window → EP = 0. Optional Gemini classification.
  2. Sector Strength — sector index vs Nifty 50 (NSE API, use closing data from previousTradingDay)
  3. High RS — stock vs Nifty % change over 60 days, threshold >15%
  4. IPO Recency — listing date <2 years, fallback chain
  5. Thrust Power — max candle range >=8% in 60 days, binary
  6. Pivot Location — ATR compression method: consolidation 20-100 days where 10-day ATR contracts to ≤50% of start ATR, price channel ≤30% of pre-consolidation swing. Pivot = channel high. Score: lower third = 0, middle = 0.5, upper third (near pivot) = 1.0. No valid base = 0.
  7. Pattern Quality — VCP heuristic (semi-discretionary), optional Gemini explanation
  8. Pivot Level Proximity — current price within 3% of pivot
- [ ] Implement ScoringContext (session_id, symbols, api_calls, cache_hits, errors, timing)
- [ ] Compose into `ScoringEngine.calculateAlgorithmicScore(symbol, context)` → PARTIAL score
- [ ] Every factor result logged to Scoring Log
- [ ] Store results in `stock_scores` table
- [ ] CLI command: `stark score [--symbol SYMBOL | --all]`

**Acceptance Criteria:**
- [ ] Factor registry lists all 13 factors with metadata
- [ ] Disabling a factor adjusts max score and threshold
- [ ] Each algorithmic factor has unit tests with known stock data
- [ ] `stark score --symbol RELIANCE` outputs factor breakdown
- [ ] `stark score --all` scores all Priority 0 stocks with rate-limiting
- [ ] Scores stored with status = PARTIAL
- [ ] Scoring log has JSONL entries for every calculation
- [ ] ScoringContext tracks API calls, cache hits, errors
- [ ] LLM enhancement works for EP catalyst when Gemini key present
- [ ] Without Gemini key, EP falls back to gap-only seamlessly
- [ ] VCP heuristic produces reasonable results on known patterns

---

### Phase 2: Review + Focus List (Weeks 4-5)

#### Step 2.1: CLI Discretionary Review

**Tasks:**
- [ ] Build review queue (status=PARTIAL, algorithmic score >= 3)
- [ ] Show algorithmic breakdown + VCP suggestion + LLM explanation
- [ ] 5 discretionary factor prompts via `@inquirer/prompts` (Linearity, NOT Pivot Cutter, AOI, HVE/HVY, 2.5HVQ)
- [ ] TradingView deep-link printed to terminal
- [ ] Manual override with reason text (logged in scoring log)
- [ ] CLI: `stark review [--symbol SYMBOL | --next]`

**Acceptance Criteria:**
- [ ] `stark review --next` shows next unreviewed stock
- [ ] All discretionary factors shown with guidance text
- [ ] Score transitions PARTIAL → COMPLETE
- [ ] Overrides logged with reason

#### Step 2.2: MBI Integration + Focus List Generation

**Tasks:**
- [ ] Implement `MBISheetClient` — fetch from Google Sheet gviz CSV endpoint (Sheet ID: `1SkXCX1Ax3n_EUsa06rzqWSdoCrlbGDENuFUOrMFyErw`)
  - Content-type validation (reject HTML login pages)
  - Parse EM + breadth columns
- [ ] Implement Chartink scraper fallback (raw breadth, no EM)
- [ ] Implement breadth-only fallback classifier (52WH%, 52WL%, SMA% → coarse regime without EM)
- [ ] Implement `BreadthCalculator` for self-calculated breadth from Angel One OHLCV (with `isWarm()` guard)
- [ ] 5-tier regime: STRONG_BULL (EM>25) / BULL (EM>15) / CAUTIOUS (12-15) / CHOPPY (9.5-12) / BEAR (<9.5)
- [ ] Configurable MBI `refresh_interval` in config (intraday seam 3)
- [ ] Focus list generator:
  - Filter: COMPLETE + score >= threshold (8.0 bull / 8.5 choppy / 9.0 bear)
  - Threshold auto-adjusts when factors disabled: `adjusted = Math.round(base × (adjMax / 13) × 2) / 2` (nearest 0.5)
  - Prioritize STRONG sector stocks, then by score
  - Limit top 3-5, pre-calculate position sizes
- [ ] Sector money flow (11 NSE sectors, STRONG/MODERATE/WEAK)
- [ ] Namespace risk config under `swing`/`intraday` (intraday seam 4)
- [ ] `captured_at` uses datetime precision in sector data (intraday seam 5)
- [ ] CLI: `stark market`, `stark focus`

**Acceptance Criteria:**
- [ ] `stark market` shows 5-tier regime with EM value and source indicator
- [ ] Sheet fetch works with gviz CSV endpoint (no auth)
- [ ] When Sheet unavailable, falls back to Chartink (shows "breadth_only" source)
- [ ] When both unavailable, falls back to self-calculated (conservative bias, no STRONG_BULL)
- [ ] `stark focus` generates list with only COMPLETE scores above regime-adjusted threshold
- [ ] Position sizes calculated and displayed
- [ ] 52WH/52WL downgrade path has acceptance test

#### Step 2.3: Evening & Morning Workflows

**Tasks:**
- [ ] `stark evening`: validate auth → fetch data → score batch → classify regime → generate focus list → show stats
- [ ] `stark morning`: check overnight gaps → re-validate setups → optional news summaries
- [ ] Optional: `stark cron --install / --remove`

**Acceptance Criteria:**
- [ ] `stark evening` scores all Priority 0 stocks with batch stats
- [ ] If session expired, exits cleanly with auth prompt
- [ ] `stark morning` detects gaps and invalidated setups
- [ ] Workflows handle API errors via fallback chains

---

### Phase 3: Journal + Performance (Weeks 6-7)

#### Step 3.1: Trade Journal

**Tasks:**
- [ ] `stark entry <SYMBOL>` — auto-fill from focus list (score breakdown, regime, sector, planned entry/stop/size), user inputs actual entry + conviction
- [ ] `stark exit <SYMBOL>` — exit price, reason, auto-calculate P&L + R-multiple + hold days
- [ ] `stark trades [--open | --closed | --all]` — view positions with filters
- [ ] `trade_type` filter on all queries (intraday seam 6)

**Acceptance Criteria:**
- [ ] `stark entry RELIANCE` pre-fills score, regime, sector
- [ ] Entry takes <30 seconds (auto-filled)
- [ ] `stark exit` calculates P&L and R-multiple correctly
- [ ] `stark trades --open` shows positions with risk amounts
- [ ] Score breakdown stored as JSON snapshot

#### Step 3.2: Portfolio Heat

**Tasks:**
- [ ] Portfolio heat = total risk / total capital (configurable, default Rs 5,00,000)
- [ ] Warning at 6%, alert at 8% (soft limits)
- [ ] CLI: `stark heat`

**Acceptance Criteria:**
- [ ] `stark heat` shows heat with per-position breakdown
- [ ] Warning during `stark entry` when heat > 8%

#### Step 3.3: Performance Validation (20+ trades)

**Tasks:**
- [ ] `stark performance` — win rate by score range, factor, regime, sector
- [ ] Override accuracy analysis
- [ ] Auto-generated insights (only when statistically meaningful)
- [ ] Guard: "Need X more trades" when insufficient data

**Acceptance Criteria:**
- [ ] Comprehensive breakdown after 20+ trades
- [ ] <20 trades shows basic stats with "need more data"
- [ ] Factor-level win rate comparison is correct

#### Step 3.4: Scoring Evolution (30+ trades)

**Tasks:**
- [ ] `stark evolve` — factor correlation, edge calculation, recommendations
- [ ] Discretionary accuracy tracking
- [ ] Guard: requires 30+ closed trades

**Acceptance Criteria:**
- [ ] Factor ranking by predictive power after 30+ trades
- [ ] Recommendations generated with supporting data

---

### Phase 4: UI (Weeks 8-9)

- Tauri OR web app decision deferred
- React + TailwindCSS + TradingView Lightweight Charts (Apache 2.0)
- All views consume `@stark/core` unchanged
- Dashboard, score detail, review GUI, journal, performance charts, portfolio heat gauge

---

## Cross-Cutting Seams (Built During Phase 1-3)

| # | Seam | Where | Effort |
|---|------|-------|--------|
| 1 | `trade_type` column in journal/positions | Step 1.1 schema | 15 min |
| 2 | Widen `OHLCVInterval` for sub-daily | Step 1.2 types | 10 min |
| 3 | Configurable MBI `refresh_interval` | Step 2.2 config | 5 min |
| 4 | Namespace risk config swing/intraday | Step 2.2 config | 10 min |
| 5 | `captured_at` datetime precision | Step 2.2 sector data | 5 min |
| 6 | `trade_type` filter on performance | Step 3.1 queries | 15 min |
| 7 | MBI composite key (date, captured_at) | Step 1.1 schema | 2 min |
| 8 | DataProvider interface | Step 1.2 | 30 min |

---

## Definition of Done (Phase 1-3 MVP)

1. `stark evening` scores all Priority 0 stocks and generates focus list in <2 minutes
2. Scoring matches mentor's system: 12 subsections, binary, 13 max, 8+ threshold, two-phase workflow
3. MBI/EM 5-tier regime classification with 3-tier fallback (Sheet → Chartink → self-calculated)
4. `@stark/core` is a pure TypeScript package (portable across CLI, Tauri, web)
5. Trade journal captures score context automatically, entry <30 seconds
6. After 20+ trades: factor-level win rate analysis
7. After 30+ trades: scoring evolution recommendations
8. Portfolio heat always visible, soft warning before over-exposure
9. All failures traceable via structured logs within 2 minutes
10. All 8 intraday seams in place (no intraday features built)
