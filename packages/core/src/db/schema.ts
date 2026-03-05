export const SCHEMA_VERSION = 1;

export interface Migration {
  version: number;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    sql: `
-- Watchlists
CREATE TABLE IF NOT EXISTS watchlists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS watchlist_stocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  watchlist_id INTEGER NOT NULL REFERENCES watchlists(id),
  symbol TEXT NOT NULL,
  token TEXT NOT NULL,
  name TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0 CHECK (priority BETWEEN 0 AND 3),
  added_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(watchlist_id, symbol)
);

-- OHLCV Cache
CREATE TABLE IF NOT EXISTS ohlcv_cache (
  symbol TEXT NOT NULL,
  interval TEXT NOT NULL,
  date TEXT NOT NULL,
  open REAL NOT NULL,
  high REAL NOT NULL,
  low REAL NOT NULL,
  close REAL NOT NULL,
  volume INTEGER NOT NULL,
  fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (symbol, interval, date)
);

-- Stock Scores (13 factor columns)
CREATE TABLE IF NOT EXISTS stock_scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT NOT NULL,
  token TEXT NOT NULL,
  name TEXT NOT NULL,
  scoring_session_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PARTIAL' CHECK (status IN ('PARTIAL', 'COMPLETE')),
  -- X Factor
  ep_catalyst REAL,
  -- Nature
  sector_strength REAL,
  high_rs REAL,
  ipo_recency REAL,
  -- Base Strength
  thrust_power REAL,
  pivot_location REAL,
  pattern_quality REAL,
  pivot_level_proximity REAL,
  -- Readiness (discretionary)
  linearity REAL,
  not_pivot_cutter REAL,
  aoi REAL,
  hve_hvy REAL,
  hvq_2_5 REAL,
  -- Totals
  algorithmic_score REAL NOT NULL DEFAULT 0,
  discretionary_score REAL NOT NULL DEFAULT 0,
  total_score REAL NOT NULL DEFAULT 0,
  max_possible_score REAL NOT NULL DEFAULT 12.5,
  override_count INTEGER NOT NULL DEFAULT 0,
  score_breakdown_json TEXT,
  data_freshness TEXT NOT NULL DEFAULT 'fresh' CHECK (data_freshness IN ('fresh', 'stale')),
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Market Context
CREATE TABLE IF NOT EXISTS market_context (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL UNIQUE,
  nifty_close REAL,
  nifty_50dma REAL,
  nifty_200dma REAL,
  mbi_regime TEXT,
  mbi_em REAL,
  mbi_source TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Sector Money Flow
CREATE TABLE IF NOT EXISTS sector_money_flow (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sector TEXT NOT NULL,
  strength TEXT NOT NULL CHECK (strength IN ('STRONG', 'MODERATE', 'WEAK')),
  index_change REAL,
  vs_nifty_change REAL,
  captured_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sector_money_flow_sector_date
  ON sector_money_flow(sector, date(captured_at));

-- Focus Lists
CREATE TABLE IF NOT EXISTS focus_lists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  regime TEXT,
  threshold REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS focus_list_stocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  focus_list_id INTEGER NOT NULL REFERENCES focus_lists(id),
  symbol TEXT NOT NULL,
  total_score REAL NOT NULL,
  rank INTEGER NOT NULL,
  entry_price REAL,
  stop_price REAL,
  position_size INTEGER,
  risk_amount REAL
);

-- LLM Cache
CREATE TABLE IF NOT EXISTS llm_cache (
  prompt_hash TEXT PRIMARY KEY,
  response TEXT NOT NULL,
  model TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Trade Journal
CREATE TABLE IF NOT EXISTS trade_journal (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT NOT NULL,
  trade_type TEXT NOT NULL DEFAULT 'swing' CHECK (trade_type IN ('swing', 'intraday')),
  entry_date TEXT NOT NULL,
  entry_price REAL NOT NULL,
  shares INTEGER NOT NULL,
  stop_price REAL,
  risk_amount REAL,
  exit_date TEXT,
  exit_price REAL,
  exit_reason TEXT CHECK (exit_reason IN ('STOPPED', 'TARGET', 'DISCRETION', 'INVALIDATED')),
  pnl REAL,
  r_multiple REAL,
  hold_days INTEGER,
  score_at_entry REAL,
  score_breakdown_json TEXT,
  market_regime_at_entry TEXT,
  sector_at_entry TEXT,
  conviction TEXT CHECK (conviction IN ('HIGH', 'MEDIUM', 'LOW')),
  override_count INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSED')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Positions
CREATE TABLE IF NOT EXISTS positions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT NOT NULL,
  trade_type TEXT NOT NULL DEFAULT 'swing' CHECK (trade_type IN ('swing', 'intraday')),
  entry_date TEXT NOT NULL,
  entry_price REAL NOT NULL,
  shares INTEGER NOT NULL,
  stop_price REAL,
  risk_amount REAL,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSED')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- MBI Daily (intraday seam 7: composite key)
CREATE TABLE IF NOT EXISTS mbi_daily (
  date TEXT NOT NULL,
  captured_at TEXT NOT NULL DEFAULT 'eod',
  source TEXT NOT NULL CHECK (source IN ('sheet', 'chartink', 'breadth_only', 'stale_cache')),
  em REAL,
  pct_52wh REAL,
  pct_52wl REAL,
  ratio_4_5 REAL,
  pct_above_20sma REAL,
  pct_above_50sma REAL,
  pct_above_200sma REAL,
  pct_below_200sma REAL,
  f10 REAL,
  f20 REAL,
  f50 REAL,
  raw_source_json TEXT,
  fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
  data_freshness TEXT NOT NULL DEFAULT 'fresh' CHECK (data_freshness IN ('fresh', 'stale')),
  PRIMARY KEY (date, captured_at)
);

-- Settings
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Schema version tracking
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- API usage tracking
CREATE TABLE IF NOT EXISTS api_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  service TEXT NOT NULL,
  call_count INTEGER NOT NULL DEFAULT 0,
  UNIQUE(date, service)
);
    `.trim(),
  },
];
