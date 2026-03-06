# Stark-Trading MVP — End-to-End Testing Guide

## Prerequisites

1. **Bun runtime** (v1.0+):
   ```bash
   curl -fsSL https://bun.sh/install | bash
   source ~/.bashrc  # or restart terminal
   bun --version     # should print 1.x.x
   ```

2. **Git** (to clone the repo)

3. **Optional**: Angel One Smart API account (for live data testing)

---

## Step 1: Clone & Install

```bash
git clone <repo-url> stark-trading
cd stark-trading
bun install
```

Verify installation:
```bash
bun run packages/cli/bin/stark.ts --help
```

Expected output:
```
stark v0.1.0 - StarkTrading CLI

USAGE:
  stark <command> [options]

COMMANDS:
  auth          Authenticate with broker and data providers
  import        Import trade history and market data
  score         Score trades and strategies
  review        Review trade performance and patterns
  ...
```

**Tip**: Create an alias for convenience:
```bash
alias stark="bun run $(pwd)/packages/cli/bin/stark.ts"
```

---

## Step 2: Run Unit Tests (No Credentials Needed)

```bash
bun run test
```

Expected: **104 tests passing across 18 files**. This validates all core logic using MockProvider (no API calls).

Key test files to look at:
- `scoring-engine.test.ts` — Factor scoring with mock data
- `trade-manager.test.ts` — Entry/exit/P&L calculation
- `portfolio-heat.test.ts` — Risk exposure calculation
- `performance.test.ts` — Win rate and breakdown analytics
- `evolution.test.ts` — Factor edge analysis
- `regime-classifier.test.ts` — MBI 5-tier classification
- `focus-list.test.ts` — Regime-adjusted focus list generation

---

## Step 3: Test CLI — Database-Only Commands (No API Needed)

These commands only need the local SQLite DB at `~/.stark/stark.db`.

### 3a. Config initialization

```bash
stark status
```

This creates `~/.stark/` directory and `config.json` with defaults. Verify:
```bash
cat ~/.stark/config.json
```

Should show default config with `totalCapital: 500000`, `heatWarning: 0.06`, etc.

### 3b. Trade Entry

```bash
stark entry RELIANCE --price 2850 --shares 100 --stop 2780 --conviction HIGH
```

Expected output:
```
Trade entered: RELIANCE
  Entry: Rs 2,850
  Shares: 100
  Stop: Rs 2,780
  Risk: Rs 7,000
  Conviction: HIGH
  Trade ID: 1

  Portfolio heat: 1.4% (OK)
```

### 3c. Enter More Trades

```bash
stark entry TCS --price 3500 --shares 50 --stop 3400 --conviction MEDIUM
stark entry INFY --price 1500 --shares 200 --stop 1450 --conviction LOW
```

### 3d. View Open Trades

```bash
stark trades --open
```

Should list all 3 open positions with entry details.

### 3e. Portfolio Heat

```bash
stark heat
```

Expected: Shows heat percentage, per-position risk breakdown, status (OK/WARNING/ALERT).

### 3f. Exit a Trade

```bash
stark exit RELIANCE --price 2950 --reason TARGET
```

Expected:
```
Trade closed: RELIANCE
  Entry: Rs 2,850
  Exit:  Rs 2,950
  P&L:   +Rs 10,000
  R:     +1.43R
  Hold:  1 days
  Reason: TARGET
```

### 3g. Exit with a Loss

```bash
stark exit TCS --price 3400 --reason STOPPED
```

Expected: Negative P&L, -1R.

### 3h. View Closed Trades

```bash
stark trades --closed
```

### 3i. View All Trades

```bash
stark trades --all
```

### 3j. Performance Report

```bash
stark performance
```

Expected: Shows win rate, avg R, total P&L, expectancy. Will say "Need X more closed trades for full analysis" since < 20 trades.

### 3k. Scoring Evolution

```bash
stark evolve
```

Expected: "Need 28 more closed trades for evolution analysis."

---

## Step 4: Test Scoring with Mock Data (No API)

The scoring engine uses MockProvider in tests. To manually test scoring flow:

### 4a. Direct Score Test

Run the scoring engine test specifically:
```bash
bun run test packages/core/tests/scoring-engine.test.ts
```

This tests:
- Single symbol scoring (RELIANCE with mock data)
- Batch scoring (RELIANCE + TCS)
- Factor registry (13 factors, enable/disable)
- Threshold adjustment when factors disabled

---

## Step 5: Test with Angel One API (Requires Credentials)

If you have Angel One Smart API credentials:

### 5a. Setup Config

Edit `~/.stark/config.json`:
```json
{
  "angelOne": {
    "apiKey": "YOUR_API_KEY",
    "clientId": "YOUR_CLIENT_ID"
  }
}
```

### 5b. Authenticate

```bash
stark auth
```

Follow prompts for MPIN and TOTP. Creates `~/.stark/session.json`.

### 5c. Check Status

```bash
stark status
```

Should show: session valid, API key configured, usage counts.

### 5d. Import Watchlist

Create a CSV file `watchlist.csv`:
```csv
symbol,name
RELIANCE,Reliance Industries
TCS,TCS Ltd
INFY,Infosys Ltd
HDFCBANK,HDFC Bank
ICICIBANK,ICICI Bank
```

```bash
stark import watchlist.csv
```

Expected: Shows count of imported symbols with token mapping.

### 5e. Score Stocks

```bash
# Score a single symbol
stark score --symbol RELIANCE

# Score all watchlist stocks
stark score --all
```

Expected: Factor breakdown with 8 algorithmic factors, PARTIAL status.

### 5f. Review (Discretionary)

```bash
stark review --next
```

Shows algorithmic breakdown, TradingView link, then prompts for 5 discretionary factors:
1. Linearity (0/0.5/1)
2. NOT Pivot Cutter (0/1)
3. Area of Interest (0/1)
4. HVE/HVY (0/1)
5. 2.5 HVQ (0/0.5)

After review, status changes to COMPLETE.

### 5g. Market Regime

```bash
stark market
```

Expected: Shows MBI regime (STRONG_BULL/BULL/CAUTIOUS/CHOPPY/BEAR), EM value, data source.

### 5h. Focus List

```bash
stark focus
```

Expected: Filtered list of COMPLETE scores above regime-adjusted threshold.

### 5i. Full Evening Workflow

```bash
stark evening
```

Runs the complete pipeline:
1. Validates auth session
2. Scores all watchlist stocks
3. Fetches MBI / classifies regime
4. Generates focus list
5. Shows summary stats

### 5j. Morning Workflow

```bash
stark morning
```

Checks overnight gaps for focus list stocks.

---

## Step 6: Validation Checklist

| Test | Expected | Pass? |
|------|----------|-------|
| `stark --help` | Shows 16 commands | |
| `bun run test` | 104 tests, 18 files, all pass | |
| `stark entry` | Creates trade, shows risk | |
| `stark exit` | Calculates P&L and R-multiple | |
| `stark trades --open` | Lists open positions | |
| `stark trades --closed` | Lists closed trades | |
| `stark heat` | Shows heat %, per-position breakdown | |
| `stark performance` | Shows stats (or "need more data") | |
| `stark evolve` | Shows "need more trades" guard | |
| Duplicate entry blocked | Error on 2nd entry for same symbol | |
| Stop loss exit | Shows -1R on stopped trade | |
| Heat WARNING at 6% | Status changes from OK | |
| Config auto-created | `~/.stark/config.json` exists | |
| DB auto-created | `~/.stark/stark.db` exists | |

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `bun: command not found` | Run `source ~/.bashrc` or reinstall Bun |
| `Cannot find module '@stark/core'` | Run `bun install` from repo root |
| `stark auth` fails | Check API key in `~/.stark/config.json` |
| `Sheet fetch HTTP 403` | Sheet ID may have changed; update `sheetId` in config |
| Tests fail on `bun:sqlite` | Ensure Bun v1.0+ (not Node.js) |

---

## Data Locations

```
~/.stark/
  config.json       # Settings (capital, thresholds, API keys)
  stark.db          # SQLite database (all data)
  session.json      # Angel One auth session
  logs/             # JSONL structured logs
```

To reset everything: `rm -rf ~/.stark/` (then re-run any command to recreate defaults).
