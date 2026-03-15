# Stark-Trading: OpenAlgo Integration Feasibility Plan

**Created:** 2026-03-04
**Status:** v2 -- Architect feedback incorporated
**Mode:** RALPLAN consensus (SHORT)
**Scope:** Evaluate whether OpenAlgo should be integrated into Stark-Trading and how
**NOT in scope:** Implementation of any OpenAlgo integration

---

## Context

Stark-Trading is a CLI-first TradingView Intelligence Layer (Bun + TypeScript + SQLite) that automates a mentor's 12-subsection binary scoring system for Indian stock trading. It has zero source code -- four plans exist (Master v5, MBI v5.1, Logging v2, Intraday Extensibility v1) but no implementation has started.

OpenAlgo is a self-hosted, open-source (AGPL v3) algo trading platform that acts as middleware between trading applications and Indian brokers. It provides a unified REST API across 30+ brokers, WebSocket streaming, paper trading, and an MCP server for AI tool integration.

**The core question:** Should Stark route its Angel One data fetching through OpenAlgo instead of calling Angel One's Smart API directly?

### Current Architecture (Planned)

```
Stark CLI (Bun) ---> Angel One Smart API (direct HTTP)
                ---> NSE public APIs (direct HTTP)
                ---> Screener.in (direct HTTP)
                ---> Google Sheet gviz (direct HTTP)
                ---> Chartink (scraping)
                ---> Gemini / Perplexity (optional LLM)
```

### Proposed Architecture (with OpenAlgo)

```
Stark CLI (Bun) ---> OpenAlgo REST API (localhost:5000) ---> Angel One Smart API
                ---> NSE public APIs (direct HTTP, unchanged)
                ---> Screener.in (direct HTTP, unchanged)
                ---> Google Sheet gviz (direct HTTP, unchanged)
                ---> Chartink (scraping, unchanged)
                ---> Gemini / Perplexity (optional LLM, unchanged)
```

---

## RALPLAN-DR Summary

### Guiding Principles

1. **Complexity must earn its keep.** Every new dependency must solve a concrete problem that the current architecture cannot solve, or solve it materially better. "Nice to have" does not justify an additional runtime (Python Flask server) for a personal CLI tool.
2. **The scoring engine IS the product.** Stark's value is in the scoring logic, not in the data transport layer. Angel One is currently the only broker, and the user has explicitly excluded order placement. The data fetching layer is a commodity -- it should be as thin as possible.
3. **Decide at the last responsible moment.** Zero source code exists. OpenAlgo can be integrated later (Phase 5+ or when switching brokers) without rewriting Stark's core. The question is not "should we ever use OpenAlgo" but "should we use it from day one."
4. **Seams over commitments.** If OpenAlgo has future value (broker portability, streaming, paper trading), the right move is to design a thin data provider interface that makes swapping trivially easy -- not to adopt the dependency before it is needed.

### Decision Drivers

1. **Operational simplicity:** Stark is a personal CLI tool for a solo developer. Adding a Python Flask server (port 5000 + WebSocket on 8765) that must be running before Stark can fetch data is a significant increase in operational overhead for every single trading session.
2. **Value delivered vs. cost incurred:** OpenAlgo's primary value propositions (unified multi-broker API, order placement, paper trading) are either out of scope (order placement) or not needed yet (multi-broker). The data endpoints it offers (quotes, history, depth) are a thin wrapper over the same Angel One APIs Stark would call directly.
3. **Future optionality:** The user trades both swing and intraday. Phase 5 (intraday) may benefit from WebSocket streaming and paper trading. But Phase 5 is months away, and the intraday extensibility plan already has 7 seams designed to keep those doors open without premature commitment.

### Viable Options

#### Option A: Direct Angel One Integration (RECOMMENDED)

**Approach:** Proceed with the current Master Plan architecture. Stark calls Angel One Smart API directly from Bun. Design a thin `DataProvider` interface in `@stark/core` that abstracts the data source, making it trivial to swap Angel One for OpenAlgo (or any other source) later.

**Pros:**
- Zero additional dependencies -- no Python server, no second process to manage
- Simpler debugging: Stark <-> Angel One, no middleware in between
- Lower latency: one fewer network hop (even on localhost, adds ~1-5ms per call)
- Matches the "local-first, no complexity tax" principle from the Master Plan
- OHLCV caching (already planned Day-1) eliminates most redundant API calls anyway
- The `DataProvider` interface keeps OpenAlgo as a future option at zero cost
- All 4 existing plans (Master, MBI, Logging, Intraday) assume direct Angel One -- no plan revisions needed

**Cons:**
- Locked to Angel One unless the `DataProvider` interface is implemented (but this is trivial)
- No WebSocket streaming (polling only) -- acceptable per Intraday Extensibility plan ("Don't build a streaming system")
- No paper trading mode -- must use live Angel One API for testing (mitigated by OHLCV cache for replay)
- If user switches brokers, must write a new API client (vs. changing one config in OpenAlgo)

#### Option B: OpenAlgo from Day One

**Approach:** Run OpenAlgo locally. Stark calls OpenAlgo's REST API instead of Angel One directly. Use the `openalgo-node` SDK or raw HTTP calls to OpenAlgo's endpoints.

**Pros:**
- Broker-agnostic from day one -- switching from Angel One to Zerodha/Groww/etc. is a config change
- WebSocket streaming available immediately (useful for Phase 5 intraday)
- Paper trading mode (1 Crore virtual capital) for testing without real API calls
- MCP server provides AI tool integration (Claude/Cursor can call OpenAlgo tools)
- Auth handled by OpenAlgo (TOTP flow managed in OpenAlgo's UI, not Stark's CLI)
- Future-proofs against Angel One API changes (OpenAlgo abstracts them)

**Cons:**
- Requires running a Python Flask server (2GB RAM, Python 3.11+) before every Stark session
- Two processes to manage: Stark CLI + OpenAlgo server (or three with WebSocket)
- OpenAlgo's `openalgo-node` SDK is on GitHub but not on npm -- maturity and maintenance unknown
- Additional failure point: OpenAlgo server crash = Stark cannot fetch data (no direct Angel One fallback without dual-path code)
- All 4 existing plans assume direct Angel One -- would require revising Master Plan (auth flow, API client, fallback chains), MBI Plan (Angel One breadth calculator), and Intraday Plan (polling architecture)
- OpenAlgo's rate limits (50/sec general, configurable) add a second rate limiting layer on top of Angel One's own limits
- Debugging becomes harder: is the bug in Stark, OpenAlgo, or Angel One?
- OpenAlgo is a single-developer open-source project (Rajandran R) -- bus factor of 1 for a critical dependency
- No benefit for non-Angel-One data sources (NSE, Screener, Chartink, Google Sheet, LLMs) -- those are still called directly

#### Option C: OpenAlgo for Intraday Only (Phase 5)

**Approach:** Build Stark with direct Angel One for swing (Phase 1-3). When Phase 5 (intraday) begins, evaluate OpenAlgo specifically for WebSocket streaming and paper trading. The `DataProvider` interface from Option A makes this a plug-in.

**Pros:**
- Gets the swing MVP out the door with zero additional complexity
- Evaluates OpenAlgo when its value propositions (streaming, paper trading) are actually needed
- By Phase 5, OpenAlgo will be more mature (more stars, better Node.js SDK, more battle-tested)
- The `DataProvider` interface makes this a clean swap without rewriting core logic
- Paper trading becomes valuable when testing intraday strategies (fast feedback loop)

**Cons:**
- Not broker-agnostic during Phase 1-3 (acceptable -- user only uses Angel One)
- If OpenAlgo adds features that would have helped in Phase 1-3, they are missed (unlikely given scope)
- Phase 5 integration still requires the Python server overhead

---

## ADR: Architecture Decision Record

### Decision

**Option A: Direct Angel One Integration** with a `DataProvider` interface seam that enables Option C (OpenAlgo for Intraday) in the future.

### Drivers

1. **Operational simplicity wins for a solo developer.** Running `stark evening` should not require first ensuring a Python Flask server is healthy. The user's workflow is "open terminal, run command, close terminal." Adding a server management step violates this.
2. **OpenAlgo's value propositions do not align with Stark's current scope.** Order placement is OUT OF SCOPE. Multi-broker support is not needed (Angel One only). WebSocket streaming is explicitly deferred per Intraday Extensibility plan. Paper trading is nice but not critical when OHLCV caching provides replay capability.
3. **Zero source code exists -- ship the MVP first.** Adding OpenAlgo to the dependency stack before writing a single line of scoring code is premature optimization of the data transport layer. The scoring engine is the product, not the data pipe.

### Alternatives Considered

- **Option B (OpenAlgo from day one):** Rejected because the operational overhead (Python server, dual-process management, plan revisions) exceeds the value delivered for a tool that only needs Angel One OHLCV data and has no order placement scope.
- **Option C (OpenAlgo for intraday only):** Not rejected -- this is the recommended future path. The `DataProvider` interface seam makes this viable at Phase 5 without rewriting Stark's core.

### Why Option A + Future Option C

The combination delivers maximum optionality at minimum cost:
- Phase 1-3 (swing MVP): Direct Angel One, simple, fast, proven architecture
- Phase 5 (intraday): Evaluate OpenAlgo for WebSocket streaming and paper trading, plug in via `DataProvider` interface
- If user switches brokers before Phase 5: Write a new API client (~1 day) or adopt OpenAlgo then

The `DataProvider` interface costs ~30 minutes to design and is good engineering regardless of OpenAlgo -- it makes testing easier (mock data provider) and supports the existing OHLCV cache layer.

### Consequences

- Stark is Angel One-specific for Phase 1-3 (acceptable -- user only uses Angel One)
- No paper trading in Phase 1-3 (mitigated by OHLCV cache replay for testing)
- No WebSocket streaming in Phase 1-3 (acceptable per Intraday Extensibility plan)
- If Angel One deprecates their current API, Stark must adapt directly (low risk -- Angel One is a major broker)
- OpenAlgo's MCP/AI tools are not available to Stark (the LLM layer uses Gemini/Perplexity directly, which is already planned)

### Follow-ups

1. **Design the `DataProvider` interface during Phase 1, Step 1.2** (Angel One API integration). This is one TypeScript interface (~20 lines) that abstracts: `fetchOHLCV()`, `fetchQuote()`, `searchSymbol()`, `getInstrumentMaster()`. The Angel One client implements it. A future OpenAlgo client would implement the same interface.
2. **Re-evaluate OpenAlgo at Phase 5 kickoff.** Quantitative decision gates:
   - (a) User wants to switch brokers → adopt OpenAlgo (estimated 2-3 days via `DataProvider` swap)
   - (b) User wants WebSocket streaming for intraday → adopt OpenAlgo IF gate (d) passes; otherwise implement Angel One WebSocket directly behind `DataProvider` (estimated 2-3 days)
   - (c) User wants paper trading for strategy testing → adopt OpenAlgo IF gate (d) passes; otherwise defer paper trading
   - (d) OpenAlgo Node.js SDK viability gate: published on npm for 3+ months, semver >= 1.0, no critical/blocking issues open, and at least one release in the last 90 days. If gate (d) fails when (b) or (c) triggers, implement Angel One WebSocket directly — do NOT wait for OpenAlgo.
3. **Monitor OpenAlgo maturity.** Check at each phase boundary: npm package availability, GitHub commit recency, Node.js SDK semver, open issue count. A mature OpenAlgo with a battle-tested Node.js SDK changes the cost/benefit calculation.
4. **If OpenAlgo is adopted in Phase 5**, it only replaces the `DataProvider` implementation for market data. NSE, Screener, Chartink, Google Sheet, and LLM integrations remain unchanged.

---

## Detailed Analysis: What OpenAlgo Offers vs. What Stark Needs

### Market Data Endpoints

| OpenAlgo Endpoint | Stark Equivalent | Value Added by OpenAlgo | Verdict |
|---|---|---|---|
| `/api/v1/history` | `angel-one.ts` `fetchOHLCV()` | Broker-agnostic wrapper | LOW -- same data, extra hop |
| `/api/v1/quotes` | `angel-one.ts` `fetchQuote()` | Real-time LTP | LOW -- Stark uses EOD data for scoring |
| `/api/v1/multiquotes` | Not planned | Batch quotes | LOW -- OHLCV cache handles batch needs |
| `/api/v1/depth` | Not planned | Market depth L5-L50 | NONE -- not used in scoring |
| `/api/v1/intervals` | Hardcoded in config | Available timeframes | NONE -- Stark knows its intervals |
| `/api/v1/symbol` | `symbol-mapper.ts` | Symbol details | LOW -- Angel One instrument master does this |
| `/api/v1/search` | `symbol-mapper.ts` | Fuzzy search | LOW -- CSV import handles mapping |

### Portfolio/Account Endpoints

| OpenAlgo Endpoint | Stark Use Case | Verdict |
|---|---|---|
| `/api/v1/funds` | Could show available capital | LOW -- user configures `total_capital` in config |
| `/api/v1/orderbook` | OUT OF SCOPE | NONE |
| `/api/v1/tradebook` | Could auto-import trades to journal | MEDIUM -- but requires order placement which is out of scope |
| `/api/v1/positionbook` | Could show live positions | LOW -- journal tracks positions manually |
| `/api/v1/holdings` | Could show portfolio for heat calc | LOW -- journal tracks positions manually |

### Unique OpenAlgo Capabilities

| Capability | Stark Value | Phase Relevance | Verdict |
|---|---|---|---|
| WebSocket streaming | Real-time data for intraday | Phase 5 only | DEFER -- Intraday plan says "don't build streaming" for now |
| Paper trading | Test strategies without real money | Phase 5 (intraday testing) | DEFER -- OHLCV cache provides basic replay for swing |
| MCP server (AI tools) | Claude/Cursor can call trading tools | Nice-to-have | LOW -- Stark's LLM layer is Gemini/Perplexity for specific tasks, not general trading AI |
| Multi-broker support | Switch from Angel One | If/when needed | DEFER -- design `DataProvider` interface as seam |
| Auth management | OpenAlgo handles TOTP | Reduces auth code in Stark | LOW -- `stark auth` is ~50 lines, not worth a Python server |

### Cost/Benefit Summary

**Note on MBI breadth calculator:** The self-calculated breadth fallback (MBI plan v5.1) fetches OHLCV for up to 500 stocks via Angel One — this is the single heaviest Angel One consumer in Stark. If OpenAlgo is ever adopted, this is the first candidate for migration to OpenAlgo's batch endpoints.

**Total OpenAlgo value for Phase 1-3:** LOW. The only tangible benefits are broker abstraction (not needed -- single broker) and auth simplification (not worth the Python server overhead).

**Total OpenAlgo value for Phase 5:** MEDIUM. WebSocket streaming and paper trading become genuinely useful for intraday trading. But the Intraday Extensibility plan explicitly says polling is sufficient and streaming is over-engineering for Stark's use case.

**Cost of OpenAlgo:** HIGH relative to value. Python 3.11+ runtime, Flask server on port 5000, WebSocket server on port 8765, 2GB RAM, process management, AGPL license awareness, additional debugging layer, dependency on a single-maintainer OSS project.

---

## Recommended Seam: DataProvider Interface

Add this to Phase 1, Step 1.2 of the Master Plan. Cost: ~30 minutes. This is the ONLY change to existing plans that this feasibility assessment recommends.

```typescript
// packages/core/src/api/data-provider.ts

interface OHLCVBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface Quote {
  symbol: string;
  ltp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timestamp: string;
}

interface SymbolInfo {
  symbol: string;
  token: string;
  exchange: string;
  name: string;
  instrumentType: string;
}

/** Error types for fallback chain discrimination */
type DataProviderErrorKind =
  | 'auth_expired'      // Prompt user to re-authenticate; do NOT fall back to stale cache
  | 'rate_limited'      // Retry after backoff; safe to queue
  | 'data_unavailable'  // Trigger fallback chain (stale cache, alternative source)
  | 'network_error';    // Retry or fall back depending on severity

class DataProviderError extends Error {
  constructor(
    message: string,
    public readonly kind: DataProviderErrorKind,
    public readonly provider: string,
    public readonly retryAfterMs?: number,
  ) {
    super(message);
  }
}

interface DataProvider {
  readonly name: string;  // 'angel-one' | 'openalgo' | 'mock'

  authenticate(credentials: AuthCredentials): Promise<void>;
  isAuthenticated(): boolean;
  dispose(): Promise<void>;  // Cleanup: close WebSocket, release tokens, etc.

  fetchOHLCV(symbol: string, interval: OHLCVInterval, from: string, to: string): Promise<OHLCVBar[]>;
  fetchQuote(symbol: string): Promise<Quote>;
  fetchQuotes(symbols: string[]): Promise<Quote[]>;

  searchSymbol(query: string): Promise<SymbolInfo[]>;
  getInstrumentMaster(): Promise<SymbolInfo[]>;
}
```

> **Note:** This interface is a starting point, not a final contract. The implementer should refine it during Phase 1 Step 1.2 based on actual Angel One API behavior (e.g., pagination needs, token metadata, timeout parameters). The interface is cheap to change while no consumers exist beyond `AngelOneProvider`. Pre-implementation interface design is inherently provisional — treat it as a draft.

**Phase 1-3:** `AngelOneProvider implements DataProvider` (`dispose()` is a no-op for stateless HTTP)
**Phase 5 (if adopted):** `OpenAlgoProvider implements DataProvider` (`dispose()` closes WebSocket on port 8765)
**Testing:** `MockProvider implements DataProvider` (returns fixture data — enables full scoring engine tests without Angel One credentials)

**Why this interface matters beyond OpenAlgo:** The `DataProvider` abstraction is independently valuable as a **testing enabler**. A `MockProvider` returning fixture data means the entire scoring engine, fallback chains, and OHLCV cache layer can be tested without live API credentials. This directly supports the test strategies in the MBI plan (unit tests with fixtures) and the logging plan (unit test: write 100 entries). The `DataProviderError` type with `kind` discriminant lets the progressive fallback chain (Master Plan Step 1.2) distinguish retriable failures from auth expiration — preventing silent fallback to stale cache when the real problem is an expired session.

---

## Impact on Existing Plans

| Plan | Impact | Changes Required |
|---|---|---|
| Master Plan (v5) | NONE | Add `DataProvider` interface to Step 1.2 (30 min). All other architecture unchanged. |
| MBI Integration (v5.1) | NONE | Self-calculated breadth uses Angel One OHLCV via `DataProvider`. No change to Sheet/Chartink paths. |
| Logging System (v2) | NONE | Logger logs data provider name in API calls. Trivial. |
| Intraday Extensibility (v1) | NONE | `DataProvider` IS the seam for future OpenAlgo. Complements existing 7 seams. |

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation | Status |
|---|---|---|---|---|
| Angel One API changes break Stark | LOW | HIGH | `DataProvider` interface isolates the impact. Only `AngelOneProvider` needs updating. | MITIGATED |
| User wants to switch brokers | LOW | MEDIUM | `DataProvider` interface allows new provider implementation. OpenAlgo becomes viable at that point. | MITIGATED |
| OpenAlgo Node.js SDK matures and becomes compelling | MEDIUM | NONE | Good news -- makes Option C (Phase 5 adoption) easier. No action needed now. | ACCEPTED |
| User regrets not having paper trading | LOW | LOW | OHLCV cache provides basic replay. True paper trading can be added via OpenAlgo in Phase 5. | ACCEPTED |
| OpenAlgo project abandoned | MEDIUM | NONE | Stark has no dependency on it. If adopted later and then abandoned, `DataProvider` allows swapping back to direct API. | N/A |

---

## Success Criteria

1. The Master Plan proceeds without OpenAlgo dependency -- no Python server required for Phase 1-3
2. A `DataProvider` interface is added to Phase 1 Step 1.2 (~30 minutes of work)
3. OpenAlgo is re-evaluated at Phase 5 kickoff with specific adoption triggers documented
4. No existing plan requires revision beyond the `DataProvider` interface addition
5. The decision is revisitable -- if the user's needs change (new broker, paper trading urgency), OpenAlgo can be adopted at any phase boundary via the `DataProvider` seam
