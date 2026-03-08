# Product Requirements Document (PRD) v4.1 (CORRECTED)

**Product:** Dexter-Trading - TradingView Intelligence Layer  
**Version:** 4.1 (Corrected Scoring System)  
**Date:** March 3, 2026  
**Status:** Design Phase - Ready for Implementation  
**Author:** Trading System Architecture Team

---

## Document Control

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 4.0 | Mar 1, 2026 | TradingView intelligence layer | Architecture Team |
| 4.1 | Mar 3, 2026 | **CORRECTED: Binary scoring system (12 subsections, threshold 8+)** | Architecture Team |

---

## CRITICAL: Scoring System Correction

**Previous v4.0 assumption (INCORRECT):**
- 6-point weighted system
- Max scores per section
- Threshold 5+

**Corrected v4.1 (ACTUAL mentor's system):**
- **Binary scoring:** Each subsection = 1 point (present) or 0 points (absent)
- **No max caps** per section
- **12 subsections total** (some with graduated scoring)
- **Max possible:** ~12.5 points
- **Threshold:** 8+ points = stock of interest

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [User Workflow Integration](#2-user-workflow-integration)
3. [Scoring System Specification](#3-scoring-system-specification)
4. [Core Features](#4-core-features)
5. [Critical Edge Cases](#5-critical-edge-cases)
6. [User Stories](#6-user-stories)
7. [Success Metrics](#7-success-metrics)
8. [Timeline](#8-timeline)

---

## 1. Executive Summary

### 1.1 Product Vision

Dexter-Trading automates your mentor's 12-subsection binary scoring system on top of your existing TradingView + ChartsMaze workflow, reducing evening prep from 2-3 hours to 5-10 minutes.

**Your Current Workflow:**
- ChartsMaze → Pattern discovery
- TradingView → Visual analysis, Priority 0,1,2,3 lists
- **Manual scoring** (2-3 hours) → Your mentor's system
- Manual trade planning

**With Dexter:**
- ChartsMaze → TradingView (unchanged)
- **Dexter automates scoring** (30 seconds)
- Flags discretionary factors for your review
- Generates focus list (8+ scores)
- Pre-calculates trade plans

**Time Savings: 2.5 hours → 10 minutes daily**

### 1.2 What Dexter IS and IS NOT

**Dexter IS:**
- ✅ Automated scoring assistant (calculates algorithmic factors)
- ✅ Focus list generator (8+ scores, market-aware)
- ✅ Trade journal (score breakdown + context)
- ✅ Performance validator (which factors work for YOU)

**Dexter IS NOT:**
- ❌ Visual chart scanner (you use TradingView)
- ❌ Pattern discovery tool (you use ChartsMaze)
- ❌ Fully automated scorer (some factors discretionary)
- ❌ Order placement system (you use Kite)

---

## 2. User Workflow Integration

### 2.1 Current Workflow (As-Is)

**EVENING (2-3 hours):**
1. ChartsMaze → Scan 500+ stocks for patterns
2. Export interesting stocks to TradingView
3. Visual review in TradingView
4. Sort into Priority 0, 1, 2, 3 watchlists
5. **Manually score each Priority 0 stock:**
   - Check EP catalyst
   - Check HVE/HVY (using "Simple Volume by Finally Nitin" indicator)
   - Check sector strength
   - Assess linearity (discretionary)
   - Check if pivot cutter (discretionary)
   - Identify AOI (discretionary)
   - Classify pivot location (High/Mid/Low)
   - Check pattern quality (VCP, IH&S, Cup & Handle)
   - ... all 12 subsections
6. Calculate position sizes manually
7. Decide tomorrow's trades

**MORNING (30-60 min):**
8. Check overnight gaps/news
9. Re-validate setups
10. Finalize trade plan

**DURING MARKET:**
11. Execute via Kite
12. Log in notebook (often incomplete)

### 2.2 Future Workflow (To-Be)

**EVENING 8:00 PM (5-10 minutes):**
1-4. [Same: ChartsMaze → TradingView → Priority lists]
5. **Import to Dexter** (CSV upload)
6. **Dexter auto-scores** algorithmic factors (30 seconds):
   - EP catalyst ✓
   - Sector strength ✓
   - High RS ✓
   - IPO ✓
   - Thrust Power ✓
   - Pattern quality ✓
   - Pivot level ✓
7. **Dexter flags discretionary** factors for your review:
   - Linearity (needs your assessment)
   - Pivot Cutter (needs your assessment)
   - AOI (needs your assessment)
   - HVE/HVY (check your TradingView indicator)
   - HVQ (check your TradingView indicator)
8. **You review flagged stocks** (2-3 minutes):
   - Click stock → TradingView chart opens
   - Confirm/adjust discretionary scores
9. **Dexter generates focus list** (8+ scores, 3-5 stocks)
10. Trade plans pre-calculated

**MORNING 9:00 AM (2 minutes):**
11. Dexter checks overnight gaps/news
12. Review morning update

**DURING MARKET (30 seconds):**
13. Stock triggers → Dexter prompts entry
14. Confirm → Log instantly

---

## 3. Scoring System Specification

### 3.1 Complete Scoring Matrix

**Total: 12 subsections, max ~12.5 points, threshold 8+**

| Section | Subsection | Points | Type | Data Source |
|---------|------------|--------|------|-------------|
| **X Factor** | | | | |
| | EP catalyst | 1 or 0 | Algorithmic | Angel One + News API |
| | HVE/HVY | 1 or 0 | **Discretionary** | User checks TradingView indicator |
| | Sector strength | 1 or 0 | Algorithmic | NSE sector indices |
| | High RS | 1 or 0 | Algorithmic | Relative to Nifty |
| | IPO | 1 or 0 | Algorithmic | Screener.in |
| **Nature** | | | | |
| | Thrust Power | 1 or 0 | Algorithmic | Angel One OHLCV |
| | Linearity | 1 or 0 | **Discretionary** | User visual assessment |
| | NOT Pivot Cutter | 1 or 0 | **Discretionary** | User visual assessment |
| **Base Strength** | | | | |
| | AOI (Area of Interest) | 1 or 0 | **Discretionary** | User identifies |
| | Pivot Location | 0 / 0.5 / 1.0 | Algorithmic | Minervini classification |
| | 2.5HVQ | 1 or 0 | **Discretionary** | User checks TradingView indicator |
| **Readiness** | | | | |
| | Pattern quality | 1 or 0 | Algorithmic | VCP, IH&S, C&H detection |
| | Pivot level | 1 or 0 | Algorithmic | Distance from pivot |

**Max Possible Score: 12.5 points**
- X Factor: 5
- Nature: 3
- Base Strength: 2.5 (includes 0.5 for mid pivot)
- Readiness: 2

**Threshold: 8+ points = stock of interest**

### 3.2 Algorithmic Factors (Dexter Calculates)

**FR-3.1: EP Catalyst Detection**
- **Criteria:**
  - Gap >8% from previous close (within last 5 days)
  - AND catalyst identified:
    - Earnings beat (Screener.in quarterly results)
    - Regulatory approval (news scan)
    - Major contract/order (news scan)
    - Acquisition announcement (news scan)
- **Scoring:** Both gap + catalyst required = 1 point, otherwise 0
- **Data Sources:** Angel One (OHLCV), News API (catalysts)

**FR-3.2: Sector Strength**
- **Criteria:**
  - Fetch stock's sector (IT, Pharma, Banking, etc.)
  - Compare sector index % change vs Nifty 50 % change (today)
  - If sector outperforming Nifty = 1 point, otherwise 0
- **Data Source:** NSE sector indices

**FR-3.3: High RS (Relative Strength)**
- **Criteria:**
  - Calculate stock's % change vs Nifty 50 % change (last 60 days)
  - If stock outperforming Nifty by >15% = 1 point, otherwise 0
- **Data Source:** Angel One OHLCV

**FR-3.4: IPO Recency**
- **Criteria:**
  - Check listing date
  - If listed <2 years ago = 1 point, otherwise 0
- **Data Source:** Screener.in

**FR-3.5: Thrust Power**
- **Criteria:**
  - Find largest candle in last 60 days
  - Candle range = (High - Low) / Low × 100
  - If max candle >=8% = 1 point, otherwise 0
- **Data Source:** Angel One OHLCV

**FR-3.6: Pivot Location (Minervini Classification)**
- **Criteria:**
  - Identify base (consolidation period, last 20-100 days)
  - Find pivot (highest point in base)
  - Classify pivot position:
    - **High pivot:** Right side of base (last 30% of base duration) = 1.0 point
    - **Mid pivot:** Middle of base (30-70% of base duration) = 0.5 points
    - **Low pivot:** Left side of base (first 30% of base duration) = 0 points
- **Algorithm:**
  ```
  base_duration = pivot_date - base_start_date
  pivot_position_pct = (pivot_date - base_start_date) / base_duration
  
  if pivot_position_pct > 0.7:  # Right side
      score = 1.0
  elif pivot_position_pct > 0.3:  # Middle
      score = 0.5
  else:  # Left side
      score = 0
  ```

**FR-3.7: Pattern Quality**
- **Criteria:**
  - Check for patterns in **Daily OR 75min** timeframe (either qualifies)
  - Patterns:
    - **VCP:** 3-touch or 4-touch (contractions with decreasing depths)
    - **Inverted Head & Shoulder**
    - **Inverted Head & Shoulder on trendline**
    - **Cup & Handle**
  - If any pattern detected in either timeframe = 1 point, otherwise 0
- **Data Source:** Angel One (Daily + 75min OHLCV)
- **Note:** Need both Daily and 75min data fetches

**FR-3.8: Pivot Level Proximity**
- **Criteria:**
  - Current price within 3% of pivot = 1 point, otherwise 0
- **Calculation:** `abs((current_price - pivot) / pivot) < 0.03`

### 3.3 Discretionary Factors (User Reviews)

**FR-3.9: Linearity**
- **What it is:** Clean, tight consolidation (not choppy)
- **How user assesses:**
  - Visual review of base in TradingView
  - Consistent daily ranges = Linear
  - Erratic, volatile ranges = Not linear
- **Dexter's role:**
  - Flag: "Linearity: NEEDS REVIEW"
  - User clicks → TradingView chart opens
  - User confirms: Linear (1) or Not (0)
- **Note:** Could assist with algorithmic suggestion based on std dev of daily ranges

**FR-3.10: NOT Pivot Cutter**
- **What it is:** Stock does NOT repeatedly fail at resistance
- **How user assesses:**
  - Count rejections at pivot level
  - If <3 rejections = NOT pivot cutter (1 point)
  - If >=3 rejections = IS pivot cutter (0 points)
- **Dexter's role:**
  - Can calculate rejections algorithmically
  - But user confirms based on visual chart assessment

**FR-3.11: AOI (Area of Interest)**
- **What it is:** Right-hand side of base where pivot forms
- **How user assesses:**
  - Visual identification in TradingView
  - Is there clear accumulation/support in right side of base?
  - Yes = 1 point, No = 0 points
- **Dexter's role:**
  - Flag: "AOI: NEEDS REVIEW"
  - User reviews chart, confirms

**FR-3.12: HVE/HVY (High Volume Earnings/Year)**
- **What it is:** Unusual volume events marked by indicator
- **How user assesses:**
  - Check "Simple Volume by Finally Nitin" indicator in TradingView
  - Look for HVE or HVY tags on volume bars
  - If present (recent) = 1 point, otherwise 0
- **Dexter's role:**
  - Flag: "HVE/HVY: CHECK YOUR TRADINGVIEW INDICATOR"
  - User checks indicator, confirms

**FR-3.13: 2.5HVQ (High Volume Quality)**
- **What it is:** Quality volume pattern indicated by TradingView indicator
- **How user assesses:**
  - Check "Simple Volume by Finally Nitin" indicator
  - Assess volume quality in 2.5-20 week base
  - High quality = 1 point, otherwise 0
- **Dexter's role:**
  - Flag: "HVQ: CHECK YOUR TRADINGVIEW INDICATOR"
  - User checks indicator, confirms

### 3.4 Scoring Workflow

**Step 1: Dexter Auto-Scores (30 seconds)**
```
For each Priority 0 stock:
  1. Fetch OHLCV (Daily + 75min)
  2. Fetch fundamentals
  3. Fetch recent news
  4. Calculate algorithmic factors (7 factors)
  5. Store partial score in database
```

**Step 2: Dexter Flags for Review**
```
Display stocks with partial scores:
  RELIANCE: 6.0 / 12.5 (Partial - 5 factors need review)
    ✓ EP catalyst
    ✓ Sector strength
    ✓ High RS
    ✗ IPO
    ✓ Thrust Power
    ❓ Linearity - NEEDS REVIEW
    ❓ NOT Pivot Cutter - NEEDS REVIEW
    ✓ Pivot Location (High): 1.0
    ❓ AOI - NEEDS REVIEW
    ❓ HVE/HVY - CHECK TRADINGVIEW INDICATOR
    ❓ HVQ - CHECK TRADINGVIEW INDICATOR
    ✓ Pattern (VCP Daily)
    ✓ At Pivot
```

**Step 3: User Reviews Flagged Items (2-3 minutes)**
```
User clicks RELIANCE:
  → Opens TradingView chart
  → Checks "Simple Volume" indicator
  → Assesses linearity, pivot cutter, AOI
  → Confirms in Dexter UI:
    [✓] Linearity: Linear
    [✓] NOT Pivot Cutter: Confirmed
    [✓] AOI: Present (right side accumulation)
    [✓] HVE/HVY: HVE tag visible
    [✓] HVQ: High quality
```

**Step 4: Dexter Calculates Final Score**
```
RELIANCE Final Score: 11.0 / 12.5
  X Factor: 4/5 (no IPO)
  Nature: 3/3
  Base Strength: 2.5/2.5
  Readiness: 2/2

→ Qualifies for focus list (8+ threshold)
```

**Step 5: Focus List Generation**
```
Apply filters:
  - Score >= 8
  - Market regime (Bull/Choppy/Bear)
  - Sector strength (prioritize STRONG sectors)
  
Top 3-5 stocks selected
```

---

## 4. Core Features

### 4.1 Watchlist Import

**FR-4.1: CSV Import from TradingView**
- Accept CSV with Symbol column (minimum)
- Optional columns: Name, Sector, Market Cap
- Support Priority 0, 1, 2, 3 lists
- Validate symbols against NSE/BSE
- Fuzzy match for typos: "RELLIANCE" → "RELIANCE"
- Import summary: "Imported 45 stocks, 2 invalid"

**FR-4.2: Watchlist Management**
- View all imported lists
- Manually add/remove symbols
- Move symbols between priority levels
- Re-import (replace existing)

### 4.2 Scoring Engine

**FR-4.3: Automated Scoring Service**
- Score all Priority 0 stocks on import
- Run daily at 8 PM (scheduled)
- Calculate algorithmic factors (7 factors)
- Flag discretionary factors (5 factors)
- Store scores with breakdown in database

**FR-4.4: Discretionary Review UI**
- Display partially-scored stocks
- Show which factors need review
- One-click to TradingView chart
- Checkboxes to confirm discretionary factors
- Recalculate final score on confirmation

**FR-4.5: Manual Score Override**
- User can override any factor score
- User provides reason: "Institutional buying detected"
- Override logged for performance review
- Can revert to algorithmic score

### 4.3 Market Context Analysis

**FR-4.6: Market Regime Classification**
- Calculate daily at 8 PM
- Nifty 50 vs 50-DMA, 200-DMA
- Breadth (% NIFTY500 above 200-DMA)
- Classify: BULL / CHOPPY / BEAR
- Store in database

**FR-4.7: Sector Money Flow Analysis**
- For each sector (11 major sectors):
  - Count setups forming (scored 8+)
  - Calculate follow-through rate (recent breakouts)
  - Measure sector index performance
- Classify: STRONG / MODERATE / WEAK
- Prioritize STRONG sector stocks in focus list

### 4.4 Focus List Generation

**FR-4.8: Daily Focus List**
- Filter by score threshold:
  - Bull market: 8+ (normal threshold)
  - Choppy market: 8.5+ (slightly higher)
  - Bear market: 9+ (only very high conviction)
- Prioritize STRONG sector stocks
- Top 3-5 stocks selected
- Pre-calculate trade plans (entry, stop, size)

**FR-4.9: Evening Report (8 PM)**
- Email + in-app notification
- Market context summary
- Focus list with score breakdowns
- Pre-calculated trade plans
- Warnings (e.g., weak sector)

**FR-4.10: Morning Update (9 AM)**
- Check overnight gaps (>±3%)
- Fetch overnight news for focus stocks
- Re-validate setups (break below base?)
- Send update ONLY if changes detected

### 4.5 Trade Journal

**FR-4.11: Entry Logging**
- Pre-fill from focus list:
  - Symbol, planned entry, size, stop
  - Score breakdown
  - Market context
- User inputs:
  - Actual entry price
  - Actual shares
  - Conviction (High/Medium/Low)
  - Emotion (Confident/Uncertain/FOMO)
  - Why entered (text, min 20 chars)
- Auto-capture:
  - Market regime at entry
  - Sector performance
  - Portfolio heat (% at risk)
- Store in database

**FR-4.12: Exit Logging**
- Exit price, date, time
- Exit reason (Stopped/Target/Discretion)
- Auto-calculate: P&L, hold days, R-multiple
- Post-trade review:
  - What learned?
  - Would take again? (Yes/No/Maybe)

**FR-4.13: Trade List View**
- Filter: Date, Score range, Win/Loss
- Sort: P&L, Date, Score
- Export CSV

### 4.6 Performance Validation

**FR-4.14: Performance Breakdown (Min 20 trades)**
- Overall: Total trades, win rate, P&L
- By score range:
  - 10-12: X trades, Y% win
  - 8-10: X trades, Y% win
  - <8: X trades, Y% win
- By individual factors:
  - EP present vs absent: Win rates
  - Sector STRONG vs WEAK: Win rates
  - Each of 12 factors analyzed
- By discretionary accuracy:
  - User overrides: Win rate
  - Algorithmic scores: Win rate

**FR-4.15: Insight Generation**
- Auto-generate insights:
  - "Your edge: 10+ scores win 85%"
  - "Your leak: <8 scores win 30%"
  - "EP factor: +30% win rate when present"
  - "Your discretionary overrides: 75% accurate"
- Identify non-working factors:
  - "RS: No correlation (55% vs 54%)"
- Recommend adjustments:
  - "Consider removing RS"
  - "Your Linearity assessment is highly accurate (85% correlation)"

### 4.7 Scoring Evolution

**FR-4.16: Factor Correlation Analysis (Min 30 trades)**
- For each of 12 factors, compare:
  - Win rate when present vs absent
  - Calculate edge (difference)
- Rank factors by predictive power
- Recommend:
  - Keep: High edge factors
  - Remove: No correlation factors
  - Increase weight: Very high edge (future enhancement)

**FR-4.17: Discretionary Accuracy Tracking**
- Track user's discretionary assessments
- Compare to outcomes:
  - When you said "Linear" → win rate?
  - When you said "NOT pivot cutter" → win rate?
- Show: "Your Linearity assessment: 82% accurate"
- Build confidence in own judgment

### 4.8 Scheduled Workflows

**FR-4.18: Evening Workflow (8 PM Daily)**
1. Check if watchlist imported today
2. Fetch latest market data
3. Score all Priority 0 stocks (algorithmic)
4. Flag discretionary factors
5. Analyze market regime + sector flow
6. Generate partial focus list (algorithmic only)
7. Send notification: "Review 8 stocks with flagged factors"

**FR-4.19: Morning Workflow (9 AM Mon-Fri)**
1. Get yesterday's focus list
2. Check overnight gaps for focus stocks
3. Fetch overnight news
4. Re-validate setups (break below base?)
5. IF changes detected: Send morning update
6. ELSE: Silent (no update needed)

### 4.9 Portfolio Risk Management

**FR-4.20: Portfolio Heat Tracking**
- For each open position:
  - Risk = (Entry - Stop) × Shares
- Sum all risks = Portfolio Heat
- Display as % of total capital
- Alert if exceeds 8% threshold
- Block new entries if at max

**FR-4.21: Position Size Calculator**
- Target risk (₹10,000 default)
- Entry price, stop price
- Calculate: Shares = Risk / (Entry - Stop)
- Show: Total investment, % of portfolio
- Pre-calculated in evening focus list

---

## 5. Critical Edge Cases

### 5.1 Discretionary Factor Workflow

**CEC-1: User Doesn't Review Flagged Factors**
- **Problem:** User imports watchlist, Dexter scores, but user never reviews discretionary factors
- **Solution:**
  - Focus list generation REQUIRES discretionary review for 8+ stocks
  - If stock has 6.0 algorithmic + potential 5 discretionary = might qualify
  - Dexter shows: "3 stocks MIGHT qualify (8+) if discretionary factors present. Review needed."
  - Can still generate focus list from fully-scored stocks (all factors confirmed)

**CEC-2: User Disagrees with Algorithmic Score**
- **Problem:** Dexter says "EP present" but user disagrees
- **Solution:**
  - Manual override available for ALL factors
  - User unchecks "EP catalyst"
  - Reason required: "Gap due to split, not catalyst"
  - Override logged, score recalculates
  - Performance review tracks: "Your overrides: 78% improve outcomes"

**CEC-3: TradingView Indicator Not Loaded**
- **Problem:** User can't check "Simple Volume" indicator (not installed)
- **Solution:**
  - In settings, user can mark: "I don't use this indicator"
  - HVE/HVY and HVQ factors disabled for that user
  - Max score becomes 11.5 (not 12.5)
  - Threshold adjusts: 7+ instead of 8+

### 5.2 Scoring Edge Cases

**CEC-4: Insufficient Data for Patterns**
- **Problem:** Stock just listed (IPO), no 60 days of data for patterns
- **Solution:**
  - Pattern quality: Automatically 0 points
  - Thrust Power: Use available data (if <60 days)
  - Flag: "Limited data available (30 days). Scores may be incomplete."
  - User can still manually override if high conviction

**CEC-5: Multiple Patterns Detected**
- **Problem:** Stock shows VCP on Daily AND Cup & Handle on 75min
- **Solution:**
  - Pattern quality = 1 point (not 2)
  - Display: "Patterns: VCP (Daily), Cup & Handle (75min)"
  - User sees richness of setup but score remains binary

**CEC-6: Pivot Location Edge Cases**
- **Problem:** Base is very short (2 weeks) or very long (30 weeks)
- **Solution:**
  - Only score if base between 2.5-20 weeks (per HVQ requirement)
  - If outside range: Pivot Location = 0 points
  - Flag: "Base duration outside optimal range (2.5-20 weeks)"

### 5.3 Data Quality

**CEC-7: Angel One Last 2 Candles Unreliable (from v2.2)**
- **Problem:** Real-time data for last 2 candles may be incomplete
- **Solution:**
  - Evening workflow runs at 8 PM (30+ min after market close)
  - By then, data is settled
  - If absolutely needed intraday: Wait 5-10 seconds after candle close

**CEC-8: Corporate Action Adjustment**
- **Problem:** Stock split/bonus causes price jump, affects scoring
- **Solution:**
  - Check for corporate actions (T+1 trading halt detection)
  - If detected: Flag "Corporate action detected - scores may be inaccurate"
  - User manually reviews before confirming

### 5.4 Performance Review Edge Cases

**CEC-9: Insufficient Trades for Analysis**
- **Problem:** User only has 5 trades, wants performance review
- **Solution:**
  - Display: "Need 15 more trades for meaningful insights"
  - Show basic stats only (win rate, total P&L)
  - Hide factor analysis until 20+ trades
  - Hide scoring evolution until 30+ trades

**CEC-10: All Discretionary Factors Overridden**
- **Problem:** User always overrides algorithmic scores
- **Solution:**
  - Track override rate
  - If >80% overridden: "You're overriding most algorithmic scores. Consider adjusting settings or relying more on discretion."
  - May indicate user's judgment superior to algorithm

---

## 6. User Stories

**US-1: Automated Scoring**
As a trader who spends 2 hours manually scoring stocks, I want Dexter to calculate algorithmic factors automatically so I only review 5 discretionary factors in 3 minutes.

**US-2: Discretionary Review**
As a discretionary trader, I want to see which factors need my visual assessment so I can quickly review TradingView charts and confirm scores.

**US-3: Focus List Generation**
As a trader, I want Dexter to filter stocks by 8+ score threshold and strong sectors so I see only 3-5 highest conviction opportunities daily.

**US-4: Market Context Awareness**
As a trader, I want to know market regime BEFORE individual stocks so I adjust my expectations (8+ in bull, 9+ in bear).

**US-5: Score Transparency**
As a trader, I want to see the complete breakdown (all 12 factors) for each stock so I validate if I agree with the score.

**US-6: Manual Override**
As a discretionary trader, I want to override any factor score with my judgment so the system adapts to my expertise.

**US-7: Performance Validation**
As a trader, after 30 trades I want to know which of the 12 factors actually correlate with MY wins so I focus on what works for ME.

**US-8: Discretionary Accuracy**
As a trader, I want to see how accurate my discretionary assessments are (Linearity, Pivot Cutter, AOI) so I build confidence in my judgment.

**US-9: Fast Trade Logging**
As a trader, when a stock triggers I want to log entry in <30 seconds with score breakdown pre-filled so I don't slow down.

**US-10: Threshold Flexibility**
As a trader, I want the score threshold to adapt to market regime (8+ in bull, 9+ in bear) so I'm appropriately aggressive/defensive.

---

## 7. Success Metrics

### 7.1 Time Savings

**Primary Metric: Evening Prep Time**
- Current: 2-3 hours manual scoring
- Target: <10 minutes (5 min review + 5 min confirmations)
- Measurement: User self-report + app analytics

**Secondary Metrics:**
- Morning update: 30-60 min → <5 min
- Live trade decisions: Slow → <1 min
- Journal completion: 60% → 100%

### 7.2 Scoring Quality

**Algorithmic Accuracy:**
- EP detection: 85%+ precision (gap + catalyst both present)
- Pattern detection: 80%+ (VCP, IH&S, Cup & Handle)
- Sector classification: 95%+ (straightforward data)

**Discretionary Accuracy:**
- Track user's discretionary assessments vs outcomes
- Target: User's assessments correlate with 70%+ win rate
- If lower: Suggest relying more on algorithmic factors

**Score Distribution:**
- Most stocks: 4-7 points (don't qualify)
- Focus stocks: 8-12 points
- <5% false positives (scored 8+ but clearly bad setup)

### 7.3 Trading Outcomes

**After 30 Trades:**
- Identify user's edge: "10+ scores win 85%"
- Identify user's leaks: "<8 scores win 35%"
- Factor correlation clear: "EP +30% edge"
- Threshold validation: Confirm 8+ is optimal, or suggest adjustment

**After 100 Trades:**
- Win rate improvement: Measurable vs baseline
- Discretionary accuracy: Track user's judgment quality
- Scoring evolution: Remove non-working factors

---

## 8. Timeline

### Phase 1: Core Scoring (Weeks 1-4)

**Week 1: Foundation**
- Database schema (12 tables)
- Angel One API integration
- Fetch OHLCV (Daily + 75min)

**Week 2: Algorithmic Factors**
- EP detection (gap + catalyst)
- Sector strength comparison
- High RS calculation
- IPO check
- Thrust Power measurement
- Pivot Location classification
- Pattern detection (VCP, IH&S, Cup & Handle)
- Pivot level proximity

**Week 3: Market Context**
- Market regime classifier
- Sector money flow analyzer
- Breadth indicators

**Week 4: Focus List Generation**
- Score threshold filtering (8+)
- Sector prioritization
- Evening report generation

### Phase 2: Discretionary Review (Weeks 5-7)

**Week 5: Review UI**
- Partially-scored stock display
- Flag discretionary factors
- TradingView integration (open charts)
- Confirmation checkboxes
- Score recalculation

**Week 6: Trade Journal**
- Entry form (pre-filled)
- Exit form
- Score breakdown storage
- Trade list view

**Week 7: Manual Override**
- Override any factor
- Reason required
- Override tracking
- Performance impact analysis

### Phase 3: Performance Validation (Weeks 8-10)

**Week 8: Performance Analytics**
- Win rate by score range
- Win rate by individual factors
- Insight generation

**Week 9: Scoring Evolution**
- Factor correlation analysis
- Non-working factor identification
- Recommendations

**Week 10: Discretionary Accuracy**
- Track user's assessments
- Accuracy calculation
- Confidence scoring

### Phase 4: Automation & Polish (Weeks 11-12)

**Week 11: Scheduled Workflows**
- Evening workflow (8 PM)
- Morning workflow (9 AM)
- Setup invalidation tracking

**Week 12: Testing & Documentation**
- End-to-end testing
- User guide
- API documentation
- Bug fixes

---

## Appendix A: Scoring Quick Reference

### Algorithmic (Dexter Calculates)
1. EP catalyst (1/0)
2. Sector strength (1/0)
3. High RS (1/0)
4. IPO (1/0)
5. Thrust Power (1/0)
6. Pivot Location (0 / 0.5 / 1.0)
7. Pattern quality (1/0)
8. Pivot level (1/0)

### Discretionary (User Reviews)
9. Linearity (1/0)
10. NOT Pivot Cutter (1/0)
11. AOI (1/0)
12. HVE/HVY (1/0) - Check TradingView indicator
13. 2.5HVQ (1/0) - Check TradingView indicator

**Total: 12-13 factors, Max 12.5 points, Threshold 8+**

---

**END OF PRD v4.1 (CORRECTED)**

*This version corrects the scoring system to match your mentor's actual binary scoring approach with 12 subsections, threshold 8+, and clear separation between algorithmic and discretionary factors.*
