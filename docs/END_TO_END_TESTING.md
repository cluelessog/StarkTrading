# Stark-Trading — QA Testing Plan

> Last updated: 2026-03-18
> Supersedes the original MVP testing guide.
> Covers all 20 CLI commands, 18 Telegram tools, MBI regime, Chartink scraper, and scheduler.

## How to Use This Guide

Work through phases 1-5 in order. Each phase builds on the previous.
Mark each step PASS/FAIL as you go. If a step fails, note the error and move on — don't block the rest of the phase.

**Before you start**, back up any existing data:
```bash
cp -r ~/.stark ~/.stark.backup.$(date +%Y%m%d)
```

**To start fresh** (clean DB + config):
```bash
rm -rf ~/.stark
```

---

## Phase 0: Environment Setup

```bash
# 0.1 — Verify Bun
bun --version
# Expected: 1.x.x

# 0.2 — Install dependencies
cd /mnt/d/Projects/SteveTrading
bun install --force
# Expected: 335 packages installed, no errors

# 0.3 — Create alias
alias stark="bun run $(pwd)/packages/cli/bin/stark.ts"

# 0.4 — Verify CLI loads
stark --help
# Expected: Shows 20 commands (auth, import, score, review, focus, market,
#           evening, morning, status, entry, exit, trades, performance,
#           heat, evolve, cron, setup, logs, mbi-analyze, sync)
```

| # | Check | Expected | Pass? |
|---|-------|----------|-------|
| 0.1 | `bun --version` | 1.x.x | |
| 0.2 | `bun install --force` | No errors | |
| 0.3 | `stark --help` | Lists 20 commands | |

---

## Phase 1: Unit & Integration Tests (No Credentials)

```bash
# 1.1 — Full vitest suite
bun run test
# Expected: 39 files, 359 tests, all pass

# 1.2 — TypeScript check
bun run typecheck
# Expected: 0 errors

# 1.3 — Lint
bun run lint
# Expected: 0 errors (warnings OK)

# 1.4 — Native bun test (DB-backed tests)
bun test packages/core/tests/db.test.ts
# Expected: 10 tests pass (schema, migrations, roundtrips)

# 1.5 — Scoring engine test
bun test packages/core/tests/scoring-engine.test.ts
# Expected: All pass (single scoring, batch, factor registry)

# 1.6 — Chartink scraper test
bun test packages/core/tests/chartink.test.ts
# Expected: 9 tests pass (percentages, ratio, errors, edge cases)

# 1.7 — MBI data manager test
bun test packages/core/tests/mbi-data-manager.test.ts
# Expected: 12 tests pass (fallback chain, cache, stale data)
```

| # | Check | Expected | Pass? |
|---|-------|----------|-------|
| 1.1 | `bun run test` | 39 files, 359 tests pass | |
| 1.2 | `bun run typecheck` | 0 errors | |
| 1.3 | `bun run lint` | 0 errors | |
| 1.4 | DB tests | Schema + roundtrips pass | |
| 1.5 | Scoring engine tests | All pass | |
| 1.6 | Chartink tests | 9 pass | |
| 1.7 | MBI data manager tests | 12 pass | |

---

## Phase 2: CLI — Offline Commands (No API Needed)

These test the trade journal, risk enforcement, and performance analytics.
Only needs local SQLite — no broker credentials.

### 2A: Config & DB Initialization

```bash
# 2A.1 — First run creates config + DB
stark status
# Expected: Creates ~/.stark/, shows config info (may warn about missing auth)

# 2A.2 — Verify config
cat ~/.stark/config.json | head -5
# Expected: JSON with totalCapital, riskPerTrade, emThresholds

# 2A.3 — Verify DB exists
ls -la ~/.stark/stark.db
# Expected: File exists, non-zero size
```

### 2B: Trade Entry & Risk

```bash
# 2B.1 — Enter first trade
stark entry RELIANCE --price 2850 --shares 100 --stop 2780 --conviction HIGH
# Expected: Trade ID 1, Risk Rs 7,000, Heat ~1.4%

# 2B.2 — Enter second trade
stark entry TCS --price 3500 --shares 50 --stop 3400 --conviction MEDIUM
# Expected: Trade ID 2, Risk Rs 5,000, cumulative heat increases

# 2B.3 — Enter third trade
stark entry INFY --price 1500 --shares 200 --stop 1450 --conviction LOW
# Expected: Trade ID 3, Risk Rs 10,000

# 2B.4 — Duplicate entry blocked
stark entry RELIANCE --price 2900 --shares 50 --stop 2850 --conviction LOW
# Expected: ERROR — RELIANCE already has an open position

# 2B.5 — View open trades
stark trades --open
# Expected: Lists 3 open trades (RELIANCE, TCS, INFY)

# 2B.6 — Portfolio heat
stark heat
# Expected: Shows total heat %, per-position risk breakdown
#           Total risk = 7000 + 5000 + 10000 = 22000
#           Heat = 22000 / 500000 = 4.4% (OK)
```

### 2C: Trade Exit & P&L

```bash
# 2C.1 — Exit with profit (target hit)
stark exit RELIANCE --price 2950 --reason TARGET
# Expected: P&L +Rs 10,000, R-multiple +1.43R

# 2C.2 — Exit with loss (stopped out)
stark exit TCS --price 3400 --reason STOPPED
# Expected: P&L -Rs 5,000, R-multiple -1.0R

# 2C.3 — View closed trades
stark trades --closed
# Expected: Shows RELIANCE (TARGET) and TCS (STOPPED)

# 2C.4 — View all trades
stark trades --all
# Expected: 3 trades — 1 open (INFY), 2 closed

# 2C.5 — Heat after exits
stark heat
# Expected: Only INFY open, heat = 10000/500000 = 2.0%
```

### 2D: Performance & Analytics

```bash
# 2D.1 — Performance report
stark performance
# Expected: 2 closed trades, 50% win rate, net P&L +Rs 5,000
#           May show "need more trades" for advanced metrics

# 2D.2 — Evolution analysis
stark evolve
# Expected: "Need N more closed trades for evolution analysis"

# 2D.3 — Logs
stark logs
# Expected: Shows recent activity logs (entries, exits)
```

### 2E: Risk Enforcement Edge Cases

```bash
# 2E.1 — Exit remaining trade
stark exit INFY --price 1480 --reason DISCRETION
# Expected: P&L -Rs 4,000

# 2E.2 — Enter high-risk trade to trigger heat warning
stark entry SBIN --price 800 --shares 500 --stop 740 --conviction HIGH
# Expected: Risk = Rs 30,000, Heat = 6.0% — should show WARNING

# 2E.3 — Try another entry to approach heat alert
stark entry HDFCBANK --price 1700 --shares 250 --stop 1660 --conviction MEDIUM
# Expected: Risk = Rs 10,000, cumulative heat = 8.0% — should show ALERT or block

# 2E.4 — Clean up
stark exit SBIN --price 800 --reason DISCRETION
stark exit HDFCBANK --price 1700 --reason DISCRETION
```

| # | Check | Expected | Pass? |
|---|-------|----------|-------|
| 2A.1 | `stark status` | Creates ~/.stark/ | |
| 2A.2 | Config exists | Valid JSON with defaults | |
| 2A.3 | DB exists | Non-zero file | |
| 2B.1 | First trade entry | Trade ID, risk, heat shown | |
| 2B.4 | Duplicate blocked | Error message | |
| 2B.5 | `stark trades --open` | 3 trades listed | |
| 2B.6 | `stark heat` | ~4.4% (OK) | |
| 2C.1 | Exit profit | +Rs 10,000, +1.43R | |
| 2C.2 | Exit loss | -Rs 5,000, -1.0R | |
| 2C.3 | Closed trades | 2 trades shown | |
| 2D.1 | Performance | 50% win rate, +Rs 5,000 | |
| 2D.2 | Evolve | "Need more trades" guard | |
| 2E.2 | Heat WARNING | Triggers at 6% | |
| 2E.3 | Heat ALERT | Triggers at 8% | |

---

## Phase 3: Live API — Broker & Market Data (Requires Angel One)

> Skip this phase if you don't have Angel One credentials.
> Ensure market hours for some tests (scoring fetches OHLCV data).

### 3A: Authentication

```bash
# 3A.1 — Setup credentials (if not already in config)
stark setup
# Follow prompts for Angel One API key, client ID, password, TOTP secret

# 3A.2 — Authenticate
stark auth
# Expected: "Session created" or "Session valid", creates ~/.stark/session.json

# 3A.3 — Verify session
stark status
# Expected: Shows "Authenticated: yes", session expiry time
```

### 3B: Watchlist & Data Import

```bash
# 3B.1 — Import watchlist from CSV
cat > /tmp/watchlist.csv << 'CSV'
symbol,name
RELIANCE,Reliance Industries
TCS,TCS Ltd
INFY,Infosys Ltd
HDFCBANK,HDFC Bank
ICICIBANK,ICICI Bank
CSV
stark import /tmp/watchlist.csv
# Expected: 5 symbols imported with NSE token mapping

# 3B.2 — Verify import
stark trades --all
# (Watchlist is separate from trades — check via score command)
```

### 3C: Scoring (Live OHLCV Data)

```bash
# 3C.1 — Score single symbol
stark score --symbol RELIANCE
# Expected: 13-factor breakdown, PARTIAL status, algorithmic score shown
#           Data fetched from Angel One API (check OHLCV cache populated)

# 3C.2 — Score all watchlist
stark score --all
# Expected: Batch scores all 5 symbols, shows summary table

# 3C.3 — Review a score (discretionary factors)
stark review --next
# Expected: Shows algorithmic breakdown for highest unreviewed stock
#           Prompts for 6 discretionary factor scores
#           After review: status changes to COMPLETE
```

### 3D: MBI & Market Regime

```bash
# 3D.1 — Market regime
stark market
# Expected: Shows MBI regime (STRONG_BULL/BULL/CAUTIOUS/CHOPPY/BEAR)
#           Shows EM value, data source (sheet/chartink/breadth_only)

# 3D.2 — Focus list
stark focus
# Expected: Shows regime-adjusted threshold, max stocks count
#           Lists COMPLETE-scored stocks above threshold (may be empty)

# 3D.3 — MBI analysis
stark mbi-analyze
# Expected: Shows MBI history, EM trend, regime transitions
```

### 3E: Workflows

```bash
# 3E.1 — Evening workflow (run after market close, 15:30+ IST)
stark evening
# Expected: Authenticates, scores all watchlist, fetches MBI, generates focus list
#           Shows summary: "Scored N stocks, Regime: X, Focus: Y stocks"

# 3E.2 — Morning workflow (run before market open, 09:00+ IST)
stark morning
# Expected: Refreshes MBI, detects regime change (if any), shows focus list
#           Shows: "N focus stocks | Regime: X"

# 3E.3 — Portfolio sync
stark sync
# Expected: Syncs broker positions with trade journal
#           Reports: "N watchlist stocks, M open trades"
```

### 3F: Chartink Fallback

```bash
# 3F.1 — Enable Chartink in config
# Add to ~/.stark/config.json:
#   "chartink": { "enabled": true }

# 3F.2 — Test MBI with Chartink as fallback
# Temporarily set an invalid sheetId to force Chartink fallback:
# Change sheetId to "invalid-sheet-id" in config, then:
stark market
# Expected: Source should show "chartink" (not "sheet")
#           Breadth percentages shown, EM = N/A (Chartink has no EM)

# 3F.3 — Restore config
# Revert sheetId to the real value
```

| # | Check | Expected | Pass? |
|---|-------|----------|-------|
| 3A.2 | `stark auth` | Session created | |
| 3B.1 | Import watchlist | 5 symbols with tokens | |
| 3C.1 | Score RELIANCE | 13 factors, PARTIAL | |
| 3C.3 | Review | Status changes to COMPLETE | |
| 3D.1 | `stark market` | Regime + EM + source | |
| 3D.2 | `stark focus` | Threshold-adjusted list | |
| 3E.1 | Evening workflow | Scores + MBI + focus | |
| 3E.2 | Morning workflow | Focus list + regime check | |
| 3F.2 | Chartink fallback | Source = "chartink" | |

---

## Phase 4: Telegram Bot (Requires Bot Token)

> Skip if no Telegram bot configured.
> Add `telegram.botToken` and `telegram.allowedChatIds` to config first.

### 4A: Bot Startup

```bash
# 4A.1 — Start the bot
bun run packages/telegram/src/index.ts
# Expected: "Bot started" message, no errors
# Open Telegram and message your bot
```

### 4B: Core Bot Commands

Test each by sending the command text to the bot:

```
# 4B.1 — Help
/help
# Expected: Lists all 18 tools

# 4B.2 — Status
/status
# Expected: Open trade count, market regime

# 4B.3 — Market
/market
# Expected: Regime, EM value, source

# 4B.4 — Trades
/trades
# Expected: Lists open trades (or "no open trades")

# 4B.5 — Heat
/heat
# Expected: Portfolio heat percentage

# 4B.6 — Score
/score RELIANCE
# Expected: 13-factor breakdown

# 4B.7 — Focus
/focus
# Expected: Focus list with threshold

# 4B.8 — Performance
/performance
# Expected: Win rate, P&L, advanced metrics

# 4B.9 — Entry
/entry SBIN 800 100 740 HIGH
# Expected: Trade logged, risk shown

# 4B.10 — Exit
/exit SBIN 820 TARGET
# Expected: P&L calculated

# 4B.11 — Logs
/logs
# Expected: Recent automation logs

# 4B.12 — MBI analysis
/mbi-analyze
# Expected: MBI history
```

| # | Check | Expected | Pass? |
|---|-------|----------|-------|
| 4A.1 | Bot starts | No errors | |
| 4B.1 | /help | 18 tools listed | |
| 4B.2 | /status | Trade count + regime | |
| 4B.6 | /score RELIANCE | Factor breakdown | |
| 4B.9 | /entry | Trade logged | |
| 4B.10 | /exit | P&L calculated | |

---

## Phase 5: Scheduler & Automation

> Requires broker auth + optionally Telegram bot.
> Best tested during market hours or by adjusting scheduled times.

### 5A: Scheduler Startup

```bash
# 5A.1 — Configure scheduler times (optional — defaults are 18:00/08:30)
# Add to ~/.stark/config.json:
#   "scheduler": {
#     "eveningTime": "18:00",
#     "morningTime": "08:30",
#     "syncIntervalMinutes": 30
#   }

# 5A.2 — Start scheduler
stark cron start
# Expected: "Scheduler started" — ticks every 60s
#           Logs show next scheduled events

# 5A.3 — For testing, set times close to current time
# e.g., if it's 14:00, set eveningTime to "14:02"
# Watch for the evening workflow to trigger within 5 minutes
```

### 5B: Verify Automation

```bash
# 5B.1 — After evening trigger fires
stark logs
# Expected: automation_log entry with action="evening_scoring", status="success"

# 5B.2 — After morning trigger fires
stark logs
# Expected: automation_log entry with action="morning_focus", status="success"

# 5B.3 — Sync runs during market hours
stark logs
# Expected: automation_log entries with action="sync"
```

| # | Check | Expected | Pass? |
|---|-------|----------|-------|
| 5A.2 | Scheduler starts | No errors, ticking | |
| 5B.1 | Evening auto-ran | Log entry with success | |
| 5B.2 | Morning auto-ran | Log entry with success | |

---

## Error Handling Checklist

These test graceful degradation — things that should fail safely, not crash.

| # | Test | Expected | Pass? |
|---|------|----------|-------|
| E.1 | `stark score --symbol FAKE` (no auth) | Auth error, not crash | |
| E.2 | `stark exit NOSYMBOL --price 100 --reason DISCRETION` | "No open trade" error | |
| E.3 | `stark entry` (no args) | Usage message | |
| E.4 | `stark market` (no internet) | Falls back to stale cache or breadth_only | |
| E.5 | `stark evening` (expired session) | Re-auth or clear error | |
| E.6 | Invalid config JSON | Error message, not crash | |

---

## Data Locations

```
~/.stark/
  config.json       # Settings (capital, thresholds, API keys, chartink config)
  stark.db          # SQLite database (all data: trades, scores, MBI, watchlists)
  session.json      # Angel One auth session (valid ~1 day)
  logs/             # JSONL structured logs
```

## Reset Commands

```bash
# Full reset (deletes ALL data)
rm -rf ~/.stark/

# Reset just the database (keeps config)
rm ~/.stark/stark.db

# Reset just the session (force re-auth)
rm ~/.stark/session.json
```

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `bun: command not found` | `source ~/.bashrc` or reinstall Bun |
| `Cannot find module '@stark/core'` | `bun install --force` from repo root |
| `stark auth` fails | Check API key in `~/.stark/config.json` |
| `Sheet fetch HTTP 403` | Sheet may need login; check `sheetId` in config |
| Tests fail on `bun:sqlite` | Use `bun test` (not `bun run test`) for native Bun tests |
| `better-sqlite3` binding error | `bun install --force` to rebuild native modules |
| Chartink scraper timeout | Rate-limited; retry in 60s |
| `CSRF token` error (Chartink) | Chartink may be down; falls back to breadth_only |
