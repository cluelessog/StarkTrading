# Plan: SteveTrading

> Last updated: 2026-03-15
> Version: 2.0

## Objective

Stark Trading Intelligence System — a Bun + TypeScript monorepo for systematic stock analysis on the Indian market (NSE/BSE via Angel One broker API). Features a 13-factor scoring engine (7 algorithmic + 6 semi-discretionary/LLM-enhanced), MBI regime classification, Telegram bot, trade journal with risk enforcement, and advanced performance analytics.

## Current Phase

maintenance — all planned sprints complete, system production-ready

## Scope

### In Scope
- 13-factor scoring engine with PARTIAL/COMPLETE lifecycle and graceful LLM degradation
- Angel One broker API integration (fail-closed auth, OHLCV data, session management)
- LLM integration (Claude primary, Gemini fallback, Perplexity for research) — all via direct fetch, no SDKs
- SQLite database with migrations (17 tables: watchlists, scores, trades, MBI, automation, chat)
- 20 CLI commands for scoring, watchlists, trade management, MBI analysis
- Telegram bot with 18 tools, NLU, and proactive notifications
- TradingScheduler for automated evening/morning/sync workflows
- Portfolio sync with risk enforcement (riskPerTrade, portfolio heat)
- MBI regime classification with 5-tier system and breadth fallback
- Advanced performance analytics (profit factor, Kelly%, drawdown, streaks)
- Mock provider gated behind `STARK_MOCK=1` for development

### Out of Scope
- Web UI or dashboard (CLI + Telegram covers current needs)
- Real-time streaming / live intraday trading (seams ready, not implemented)
- Multi-broker support
- Backtesting engine
- Options trading

## Packages

| Package | Path | Purpose |
|---------|------|---------|
| `@stark/core` | `packages/core/` | Pure TypeScript library. Zero runtime deps beyond Bun built-ins |
| `@stark/cli` | `packages/cli/` | CLI application (20 commands). Depends on core |
| `@stark/telegram` | `packages/telegram/` | Telegram bot (18 tools). Depends on core + cli |

## Milestones

| # | Milestone | Status |
|---|-----------|--------|
| 1 | Core architecture (@stark/core + @stark/cli) | completed |
| 2 | 13-factor scoring engine | completed |
| 3 | Angel One integration + session management | completed |
| 4 | LLM integration (Claude/Gemini/Perplexity) | completed |
| 5 | MBI regime classification + breadth fallback | completed |
| 6 | Logging system + intraday seams | completed |
| 7 | Trade journal + position tracking | completed |
| 8 | Telegram bot + scheduler + portfolio sync | completed |
| 9 | Advanced performance analytics | completed |
| 10 | Code audit fixes (9 findings, 5 phases) | completed |

## Backlog (Not Yet Planned)

| Item | Notes |
|------|-------|
| Chartink Scraper (unstub) | Live MBI data; currently using Google Sheet fallback |
| Intraday Trading | Seams ready from Sprint 3, needs design plan |
| Credential Encryption | OS keychain for API keys, TOTP secret |
| RPi Deployment | Deploy Telegram bot + scheduler (docs in `docs/stark-rpi-telegram.md`) |
| OpenAlgo Integration | Feasibility plan in `.omc/plans/archive/` |
| Config-driven MAX_FOCUS | `scoreThresholds` exists but maxStocks not yet configurable |

## Open Questions

- Chartink scraping feasibility (rate limits, page structure stability)
- NTFS requirement for bun:sqlite tests (source on exFAT, tests on NTFS) — workflow friction

## Dependencies

- Angel One broker account + API credentials
- Bun runtime
- Tests must run from NTFS path (/mnt/c/) due to bun:sqlite file locking
