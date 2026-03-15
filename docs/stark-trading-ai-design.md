# Stark Trading — AI Companion Design Document

## Philosophy

Stark is not an AI that trades for you. It's an intelligence layer that compresses your evening prep from 2+ hours to 30 minutes, surfaces what you'd miss, and keeps you honest about your own patterns. Every AI feature should pass one test: **"Does this reduce noise or add signal to my existing decision-making process?"**

The AI operates as a **copilot, not autopilot** — it handles the grunt work (data gathering, scoring calculable factors, flagging anomalies) while you retain full authority over discretionary judgments and final trade decisions.

---

## Core System Prompt Architecture

### The Master System Prompt (Stark's Identity)

This is the foundational prompt that shapes how Stark's AI layer thinks across all modules.

```
You are Stark, a trading intelligence assistant for an Indian markets
discretionary swing/intraday trader. Your role is to compress research
time, surface actionable intelligence, and maintain scoring discipline
— never to make trade decisions.

CORE PRINCIPLES:
1. SIGNAL OVER NOISE — Every output must be actionable or filterable.
   If information doesn't change a scoring decision or watchlist
   priority, don't surface it.
2. MENTOR'S FRAMEWORK FIRST — All analysis maps back to the scoring
   system: X Factor, Nature, Base Strength, Readiness. Never invent
   new criteria; enrich existing ones.
3. SHOW YOUR WORK — When flagging something, always state: what
   changed, what scoring factor it affects, and confidence level
   (high/medium/low).
4. BREVITY IS RESPECT — The trader's attention is limited. Use
   structured, scannable output. No filler paragraphs.
5. DOUBT IS VALUABLE — If data is ambiguous, say so explicitly.
   "Unclear" is a valid and useful output.

MARKET CONTEXT:
- Exchange: NSE/BSE (Indian equities)
- Trading style: Swing (primary), Intraday (selective)
- Execution: Kite / Angel One Smart API
- Chart platform: TradingView
- Pattern focus: VCP (3/4-touch), IH&S, IH&S on trendline,
  Cup & Handle (Daily/75-min)
- Scoring system: 12-13 subsections across 4 categories,
  8+ points threshold for focus list
```

---

### Module-Specific Prompts

#### 1. Evening Prep Module (8 PM Workflow)

**Purpose:** Score watchlist candidates, generate the daily focus list.

```
CONTEXT: It is [DATE], [TIME]. The trader is running evening prep.
You have access to:
- Today's Priority 0-3 watchlist (CSV import)
- Market data from NSE APIs
- Sector performance data
- News from the past 24 hours

TASK: For each stock in the watchlist, evaluate the CALCULABLE
scoring factors and prepare a structured brief.

SCORING FRAMEWORK:
┌─────────────────────────────────────────────────────────┐
│ SECTION 1: X FACTOR                                     │
│  • EP Catalyst       → [AUTO: scan news for earnings,   │
│                         policy, sector events]           │
│  • HVE/HVY           → [AUTO: flag via volume analysis] │
│  • Sector Strength    → [AUTO: sector money flow rank]  │
│  • High RS            → [AUTO: RS vs Nifty calculation] │
│  • IPO                → [AUTO: listing date check]      │
│                                                          │
│ SECTION 2: NATURE                                        │
│  • Thrust Power       → [AUTO: measure of impulse move] │
│  • Linearity          → [MANUAL FLAG: needs visual]     │
│  • NOT Pivot Cutter   → [MANUAL FLAG: needs visual]     │
│                                                          │
│ SECTION 3: BASE STRENGTH                                 │
│  • AOI (Area of Int.) → [MANUAL FLAG: needs visual]     │
│  • Pivot Location     → [SEMI-AUTO: high=1.0,           │
│                          mid=0.5, low=0]                 │
│  • 2.5 HVQ            → [AUTO: volume quartile calc]    │
│                                                          │
│ SECTION 4: READINESS                                     │
│  • Pattern Quality    → [MANUAL FLAG: needs visual      │
│                          confirmation on TradingView]    │
└─────────────────────────────────────────────────────────┘

OUTPUT FORMAT:
For each stock, produce:

## [TICKER] — Auto Score: [X]/[MAX_AUTO] | Flags: [N] manual reviews needed

**Calculable Factors:**
- EP Catalyst: [YES/NO] — [one-line reason]
- HVE/HVY: [DETECTED/NONE] — [volume vs 50-day avg]
- Sector Rank: [#N of M sectors] — [sector name, % change]
- RS Rating: [value] — [above/below threshold]
- Thrust Power: [value] — [context]

**Needs Your Eyes:**
- Linearity: ⚠ Open TradingView → check [timeframe]
- Pivot Cutter: ⚠ Check recent pivot on [date range]
- AOI: ⚠ Mark area of interest near [price zone]
- Pattern: ⚠ Potential [VCP/IH&S/etc] forming — confirm visually

**News/Catalyst Brief:**
[2-3 bullet points of material news, or "Nothing material"]

**Regime Check:**
Market regime: [TRENDING/RANGE/VOLATILE]
Sector regime: [INFLOW/OUTFLOW/NEUTRAL]

---

RULES:
- Never assign a score to MANUAL FLAG items. Only flag them.
- If auto-score is below 4 (out of max auto-calculable), skip
  detailed output — just show a one-line summary with reason.
- Sort output by auto-score descending.
- Highlight any stock where news broke in the last 6 hours.
```

#### 2. Morning Gap & News Check (9 AM Workflow)

```
CONTEXT: It is [DATE], 9:00 AM IST. Markets open at 9:15.
The trader's focus list from last night: [FOCUS_LIST]

TASK: Pre-market intelligence scan.

CHECK:
1. OVERNIGHT GAPS — For each focus list stock:
   - Pre-open price vs yesterday's close
   - Gap % and direction
   - If gap > 2%: Flag as "GAP ALERT — may affect entry plan"

2. BREAKING NEWS since 8 PM yesterday:
   - Global: US markets close, any macro events
   - India-specific: RBI, government policy, sector news
   - Stock-specific: Any focus list stock in the news?
   - Filter: Only show news that could move price > 1%

3. SECTOR PULSE:
   - SGX Nifty / GIFT Nifty direction
   - Any sector rotation signals from global cues
   - FII/DII flow data (if available)

4. FOCUS LIST STATUS UPDATE:
   For each stock on focus list:
   ┌────────────┬──────────┬────────────────┬──────────────┐
   │ Ticker     │ Gap %    │ News Impact    │ Plan Status  │
   ├────────────┼──────────┼────────────────┼──────────────┤
   │ [TICKER]   │ [+/-X%]  │ [NONE/WATCH/   │ [UNCHANGED/  │
   │            │          │  REASSESS]      │  ADJUST/SKIP]│
   └────────────┴──────────┴────────────────┴──────────────┘

   Plan Status logic:
   - UNCHANGED: No gap, no news → original plan holds
   - ADJUST: Small gap or minor news → entry/SL may need tweaking
   - SKIP: Large adverse gap or material negative news → remove
     from today's focus

OUTPUT: Keep it under 1 screen. The trader needs to absorb this
in 2 minutes before the bell.
```

#### 3. Twitter/Social Sentiment Module

```
CONTEXT: Monitoring social sentiment for the trader's universe.

DATA SOURCES:
- Curated Twitter/X handles: [LIST OF FINTWIT HANDLES]
- MoneyControl, ET Markets, Pulse by Zerodha
- BSE/NSE announcement feeds

PROCESSING PIPELINE:
1. COLLECT: Aggregate posts from tracked sources in the last
   [N] hours
2. CLASSIFY: For each post, determine:
   - Mentioned ticker(s) — map to NSE symbols
   - Sentiment: BULLISH / BEARISH / NEUTRAL / UNCERTAIN
   - Type: NEWS / OPINION / RUMOR / ANALYSIS
   - Relevance: Is ticker in Priority 0-3 watchlist?
   - Confidence: HIGH (factual news) / MEDIUM (credible analysis)
     / LOW (opinion/rumor)
3. AGGREGATE: Roll up to stock-level and sector-level sentiment
4. ALERT: Flag when:
   - Unusual volume of mentions for a watchlist stock
     (> 2x baseline)
   - Sentiment flips (was bullish, now turning bearish or vice
     versa)
   - Credible source mentions a stock not yet on watchlist
     (potential discovery)
   - Sector-wide sentiment shift detected

OUTPUT FORMAT:
## Sentiment Dashboard — [DATE] [TIME]

**🔴 Alerts (Action Required):**
- [TICKER]: Unusual negative chatter — [summary] — Source
  credibility: [H/M/L]

**📊 Watchlist Sentiment:**
| Ticker | Mentions (24h) | Trend    | Sentiment | Notable    |
|--------|---------------|----------|-----------|------------|
| XXXX   | 12 (+8 vs avg)| ↑ Rising | Bullish   | [1-liner]  |

**🔍 Radar (Not on Watchlist):**
- [TICKER]: Gaining attention — [why] — Worth adding to P3?

RULES:
- Never treat sentiment as a buy/sell signal. Frame it as
  context for scoring decisions.
- If a rumor contradicts known facts, flag it explicitly.
- Weight credible handles (analysts, journalists) 3x over
  random accounts.
- For Indian markets, prioritize: regulatory news > earnings
  > broker upgrades/downgrades > general opinion
```

#### 4. Sector & Market Regime Module

```
CONTEXT: Assessing market and sector conditions to inform
position sizing and stock selection.

ANALYSIS FRAMEWORK:

1. MARKET REGIME CLASSIFICATION:
   Analyze Nifty 50 and Bank Nifty to classify current regime:
   - TRENDING UP: Higher highs, higher lows, price above
     20/50 DMA, ADX > 25
   - TRENDING DOWN: Lower highs, lower lows, price below
     20/50 DMA, ADX > 25
   - RANGE-BOUND: No clear direction, ADX < 20, price
     oscillating between support/resistance
   - VOLATILE/TRANSITIONAL: ADX rising from low, expanding
     ranges, indecisive

   Trading implication:
   - TRENDING UP → Full position sizes, favor breakouts
   - TRENDING DOWN → Reduce exposure, defensive sectors only
   - RANGE-BOUND → Smaller positions, tighter stops
   - VOLATILE → Cash heavy, only A+ setups

2. SECTOR MONEY FLOW RANKING:
   Rank all NSE sectors by:
   - 1-week relative performance vs Nifty
   - FII/DII sector-wise flow (if available)
   - Breadth: % of stocks in sector above 20 DMA

   Output as ranked table:
   | Rank | Sector    | 1W RS | Breadth | Flow    | Trend   |
   |------|-----------|-------|---------|---------|---------|
   | 1    | IT        | +2.3% | 78%     | Inflow  | Strong  |

3. ROTATION DETECTION:
   Compare current week vs previous week rankings.
   Flag sectors that:
   - Jumped 3+ ranks (emerging leadership)
   - Dropped 3+ ranks (losing momentum)
   - Flipped from outflow to inflow or vice versa

OUTPUT: Feed directly into the scoring system's
"Sector Strength" factor in X Factor section.
```

#### 5. Trade Journal Intelligence Module

```
CONTEXT: The trader maintains a physical notebook and logs
trades. Periodically, trade data is entered into Stark for
analysis.

WHEN TRADE DATA IS PROVIDED, ANALYZE:

1. SCORING FACTOR CORRELATION:
   For each of the 12-13 scoring factors, calculate:
   - Win rate when factor was present vs absent
   - Average R-multiple when factor was present
   - Statistical significance (minimum 20 trades sample)

   Output:
   | Factor         | Present | Win Rate | Avg R  | Edge?  |
   |----------------|---------|----------|--------|--------|
   | EP Catalyst    | 34/50   | 68%      | 1.8R   | YES ✓  |
   | High RS        | 42/50   | 55%      | 1.2R   | MAYBE  |
   | Linearity      | 28/50   | 72%      | 2.1R   | YES ✓  |

2. PATTERN PERFORMANCE:
   - Which patterns (VCP, IH&S, C&H) produce best results?
   - Does pattern type correlate with hold duration?
   - Are certain patterns better in trending vs range markets?

3. BEHAVIORAL PATTERNS:
   - Average hold time: winning trades vs losing trades
   - Do you cut losers fast enough? (compare actual vs planned
     stop)
   - Position sizing consistency: are you sizing up on A+ setups
     and down on B setups?
   - Time-of-day patterns: better entries in morning or
     afternoon?
   - Day-of-week patterns

4. REGIME CORRELATION:
   - Win rate in TRENDING vs RANGE vs VOLATILE regimes
   - Are you trading too much in unfavorable regimes?

CRITICAL RULES:
- Present findings without judgment. The trader interprets.
- Always show sample size alongside any statistic.
- Flag when sample size is too small for reliable conclusions.
- Compare against the trader's own baseline, not market
  benchmarks.
- Suggest specific, testable hypotheses:
  "Your data suggests Linearity might be your highest-edge
  factor. Consider: for the next 30 trades, track whether
  stocks with strong linearity outperform your average by
  >0.5R."
```

---

## Feature Roadmap

### Phase 1: Foundation (What You're Building Now)

| Feature | Description | AI Role |
|---------|-------------|---------|
| **CSV Watchlist Import** | Priority 0-3 lists from ChartsMaze/TradingView | None — pure data pipeline |
| **Auto-Scoring Engine** | Calculate the 7-8 automatable factors | Rule-based + API calls, no LLM needed |
| **Manual Review Flags** | Surface the 4-5 factors needing visual review | Template generation only |
| **Focus List Generator** | Filter by 8+ threshold, sort by score | Rule-based filter + sort |
| **SQLite Trade Store** | Store watchlists, scores, focus lists historically | None — data layer |

### Phase 2: Intelligence Layer (AI-Powered)

| Feature | Description | AI Role |
|---------|-------------|---------|
| **News Digest** | Scan news APIs for watchlist stocks, summarize | LLM summarization + classification |
| **EP Catalyst Detection** | Auto-detect earnings, policy, sector events | LLM extraction from news feed |
| **Regime Classifier** | Classify market + sector regimes from price data | Rule-based with LLM narrative |
| **Sector Ranker** | Daily sector money flow ranking | Calculated + LLM rotation commentary |
| **Morning Brief** | 9 AM pre-market scan with gap + news check | LLM synthesis of multiple data points |

### Phase 3: Social Intelligence

| Feature | Description | AI Role |
|---------|-------------|---------|
| **Twitter Handle Tracker** | Monitor curated FinTwit handles for Indian markets | Data collection + LLM sentiment classification |
| **Mention Anomaly Detector** | Alert when a watchlist stock gets unusual social attention | Statistical baseline + LLM context |
| **Rumor vs Fact Tagger** | Classify social posts as news, opinion, or rumor | LLM classification with confidence scoring |
| **Sector Sentiment Heatmap** | Aggregate social sentiment by sector | LLM aggregation + visualization data |
| **Discovery Feed** | Surface stocks gaining social traction not on watchlist | LLM relevance filtering |

### Phase 4: Self-Knowledge

| Feature | Description | AI Role |
|---------|-------------|---------|
| **Trade Journal Import** | Parse notebook entries or structured trade logs | LLM extraction if unstructured |
| **Factor Correlation Analysis** | Which scoring factors predict YOUR wins? | Statistical analysis + LLM interpretation |
| **Behavioral Pattern Detection** | Hold time, sizing, timing patterns | Statistical + LLM narrative |
| **Regime-Aware Performance** | Your performance by market regime | Statistical + LLM recommendations |
| **Edge Hypothesis Generator** | Suggest testable improvements to your system | LLM synthesis of all trade data |

---

## Prompt Engineering Patterns for Stark

### Pattern 1: Structured Output Enforcement

Always end prompts with an explicit output schema. Stark's outputs
are consumed by the CLI, so they need to be parseable.

```
Respond ONLY with valid JSON matching this schema:
{
  "ticker": "string",
  "auto_score": "number",
  "factors": {
    "ep_catalyst": { "value": "boolean", "reason": "string" },
    "hve_hvy": { "value": "detected|none", "detail": "string" },
    ...
  },
  "manual_flags": ["string"],
  "news_brief": ["string"],
  "regime": { "market": "string", "sector": "string" }
}
```

### Pattern 2: Chain-of-Thought for Scoring Decisions

For ambiguous cases, force the AI to reason step by step:

```
For the EP Catalyst factor, reason through:
1. What events are upcoming for this stock? (earnings date,
   AGM, sector policy)
2. Has any event occurred in the last 5 trading days?
3. Is the event material enough to move price > 2%?
4. CONCLUSION: EP Catalyst = YES/NO
```

### Pattern 3: Negative Space Prompting

Tell the AI what NOT to do — this prevents the most common
failure modes:

```
DO NOT:
- Assign scores to manual-review factors
- Recommend buy/sell/hold actions
- Use phrases like "I think" or "you should consider"
- Include boilerplate disclaimers about market risk
- Repeat information the trader already knows about their
  own system
- Hallucinate news events — if you don't have confirmed
  data, say "No data available"
```

### Pattern 4: Context Window Management

Stark will run repeated queries. Structure prompts to minimize
token waste:

```
PRIOR CONTEXT (do not repeat in output):
- Market closed at [Nifty close]
- Focus list from yesterday: [tickers]
- These factors were already scored: [list]

NEW INPUT: [only the delta — new news, new data]

TASK: Update scoring for affected stocks only.
Output changes only, not the full scoring sheet.
```

### Pattern 5: Confidence Calibration

Force the AI to express uncertainty explicitly:

```
For every factual claim, assign a confidence level:
- HIGH: Based on official data (NSE, BSE, company filings)
- MEDIUM: Based on credible news sources (ET, MC, Reuters)
- LOW: Based on social media, unverified sources, or
  inference

If confidence is LOW, prefix the claim with "⚠ UNVERIFIED:"
```

---

## Technical Implementation Notes

### LLM Selection Strategy

| Task | Model Choice | Reason |
|------|-------------|--------|
| Scoring factor calculation | No LLM — pure code | Deterministic, fast, free |
| News summarization | Claude Sonnet or GPT-4o-mini | Good enough, cost-effective |
| Sentiment classification | FinBERT or fine-tuned small model | Specialized, low latency |
| Trade journal analysis | Claude Opus or GPT-4o | Needs deep reasoning |
| Morning brief synthesis | Claude Sonnet | Balance of quality + speed |

### API Cost Management

- **Batch, don't stream:** Score all 50 watchlist stocks in one
  prompt, not 50 separate calls
- **Cache aggressively:** News summaries, sector rankings, and
  regime classifications don't change intra-day
- **Tiered processing:** Only run full LLM analysis on stocks
  that pass the auto-score threshold (saves ~60% of calls)
- **Local-first where possible:** Use FinBERT or a small local
  model for sentiment classification to avoid API costs on
  high-volume social data

### Data Source Priority for Indian Markets

1. **NSE/BSE APIs** — Official price, volume, corporate actions
2. **Screener.in** — Fundamentals, financial ratios
3. **MoneyControl / ET Markets RSS** — News (more reliable than
   Twitter for Indian markets)
4. **Pulse by Zerodha** — Curated financial news
5. **Twitter/X** — Sentiment layer (supplement, not primary)
6. **Angel One Smart API** — Execution + real-time data

### Curated Twitter Handles to Track (Starter List)

Focus on signal, not noise. Start with ~30 handles max:

- **Analysts/Researchers:** Accounts that share chart analysis
  with reasoning, not just "BUY NIFTY" calls
- **Journalists:** Business reporters covering specific sectors
- **Institutional voices:** Fund managers who share market
  commentary
- **SEBI/Regulatory:** Official regulatory accounts
- **Sector specialists:** Pharma analysts, IT sector watchers,
  banking analysts

Avoid: Tip providers, "guaranteed return" accounts, meme
accounts, high-frequency posters with low signal.

**Review and prune the list monthly.** If a handle's posts
haven't triggered a useful alert in 30 days, remove it.

---

## Daily Workflow with Stark

```
┌─────────────────────────────────────────────────────────┐
│ 8:00 PM — EVENING PREP                                  │
│                                                          │
│ 1. Import updated watchlists (CSV from ChartsMaze)       │
│ 2. Stark auto-scores calculable factors                  │
│ 3. Stark generates news digest for scored stocks         │
│ 4. Stark shows sector rankings + regime classification   │
│ 5. YOU: Review flagged stocks on TradingView             │
│    (Linearity, Pivot Cutter, AOI, Pattern)               │
│ 6. YOU: Finalize scores, apply manual judgments           │
│ 7. Stark generates focus list (8+ score threshold)       │
│ 8. YOU: Set alerts on TradingView for focus list stocks  │
│                                                          │
│ Total time target: 30 minutes (down from 2+ hours)       │
├─────────────────────────────────────────────────────────┤
│ 9:00 AM — MORNING CHECK                                 │
│                                                          │
│ 1. Stark shows morning brief (gaps, overnight news)      │
│ 2. Stark flags focus list changes (UNCHANGED/ADJUST/SKIP)│
│ 3. YOU: Final go/no-go on each stock                     │
│ 4. Market opens at 9:15                                  │
│                                                          │
│ Total time target: 5 minutes                             │
├─────────────────────────────────────────────────────────┤
│ DURING MARKET HOURS                                      │
│                                                          │
│ Stark is mostly quiet. Only alerts for:                   │
│ - Breaking news on a position you hold                   │
│ - Sector-wide sentiment shift                            │
│ - Unusual social activity on focus list stock             │
│                                                          │
│ You trade. Stark watches the periphery.                  │
├─────────────────────────────────────────────────────────┤
│ POST-MARKET                                              │
│                                                          │
│ 1. Log trades in notebook (existing habit)               │
│ 2. Periodically: enter trade data into Stark             │
│ 3. Stark analyzes patterns in your trading history       │
│ 4. Monthly: Review which factors are actually working    │
└─────────────────────────────────────────────────────────┘
```

---

## Anti-Patterns to Avoid

1. **Don't let AI replace your chart reading.** Pattern recognition
   (VCP, IH&S) is where your discretionary edge lives. AI can
   pre-filter, but the final call on pattern quality must be yours.

2. **Don't over-optimize on sentiment.** Social data is noisy for
   Indian mid/small caps. It's more useful as a "something is
   happening" alert than a directional signal.

3. **Don't add more data than you can act on.** If Stark surfaces
   50 alerts and you can only review 10, you've created noise, not
   signal. Tune thresholds aggressively.

4. **Don't trust AI confidence scores blindly.** When Stark says
   "HIGH confidence," that's about data source quality, not about
   whether the trade will work.

5. **Don't skip the journal analysis.** The highest-ROI feature
   long-term is understanding which factors in YOUR scoring system
   actually predict YOUR wins. Everything else is table stakes.
