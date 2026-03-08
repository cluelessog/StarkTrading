# Implementation Guide - Dexter Trading v4.0

**Guide:** Quick-Start Implementation Guide  
**Version:** 4.0  
**Date:** March 1, 2026  
**Purpose:** Step-by-step guide to build Dexter TradingView Intelligence Layer

---

## Table of Contents

1. [Week-by-Week Roadmap](#1-week-by-week-roadmap)
2. [Development Setup](#2-development-setup)
3. [Phase 1: Core Scoring (Weeks 1-4)](#3-phase-1-core-scoring)
4. [Phase 2: Journal & Performance (Weeks 5-7)](#4-phase-2-journal--performance)
5. [Phase 3: Automation (Weeks 8-10)](#5-phase-3-automation)
6. [Phase 4: Integration (Weeks 11-12)](#6-phase-4-integration)
7. [Testing Checklist](#7-testing-checklist)
8. [Deployment](#8-deployment)

---

## 1. Week-by-Week Roadmap

### Quick Reference

| Week | Focus | Deliverable | Test |
|------|-------|-------------|------|
| 1 | Database + APIs | Schema + Angel One connection | Fetch OHLCV for RELIANCE |
| 2 | Scoring Engine | All 6 factors working | Score 10 stocks manually |
| 3 | Market Context | Regime + Sector flow | Classify today's market |
| 4 | Focus List | Filter + generate list | Evening report for Priority 0 |
| 5 | Trade Journal | Entry/exit logging | Log 1 mock trade |
| 6 | Performance | Win rate by factor | Review mock 20 trades |
| 7 | Scoring Evolution | Recommendations | "Remove RS" insight |
| 8 | Evening Workflow | 8 PM automation | Auto-run at 8 PM |
| 9 | Morning Workflow | 9 AM update | Auto-run at 9 AM |
| 10 | Invalidation | Setup tracking | Detect break below base |
| 11 | TradingView Import | CSV upload | Import your real watchlist |
| 12 | Polish + Testing | Bug fixes, docs | End-to-end test with real data |

---

## 2. Development Setup

### 2.1 Tech Stack Installation

**Prerequisites:**
```bash
# Install Bun (runtime)
curl -fsSL https://bun.sh/install | bash

# Install Rust (for Tauri)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Verify installations
bun --version
cargo --version
```

**Initialize Project:**
```bash
# Create project
mkdir dexter-trading
cd dexter-trading

# Initialize Tauri + React
bun create tauri-app
# Choose: TypeScript, React

# Install dependencies
bun install

# Additional packages
bun add @tanstack/react-query
bun add recharts
bun add papaparse  # CSV parsing
bun add node-cron  # Scheduling
bun add better-sqlite3  # Database
```

### 2.2 Project Structure

```
dexter-trading/
├── src-tauri/                # Rust backend
│   ├── src/
│   │   ├── main.rs
│   │   ├── database.rs       # SQLite operations
│   │   ├── scheduler.rs      # Cron jobs
│   │   └── commands.rs       # Tauri commands
│   ├── Cargo.toml
│   └── tauri.conf.json
│
├── src/                      # React frontend
│   ├── components/
│   │   ├── import/
│   │   │   └── WatchlistImport.tsx
│   │   ├── focus/
│   │   │   └── FocusList.tsx
│   │   ├── journal/
│   │   │   ├── EntryForm.tsx
│   │   │   └── ExitForm.tsx
│   │   └── performance/
│   │       └── PerformanceReview.tsx
│   │
│   ├── services/             # Business logic
│   │   ├── watchlist-importer.ts
│   │   ├── scoring-engine.ts
│   │   ├── market-regime.ts
│   │   ├── sector-flow.ts
│   │   ├── focus-list-generator.ts
│   │   ├── trade-journal.ts
│   │   └── performance-validator.ts
│   │
│   ├── api/                  # External APIs
│   │   ├── angel-one.ts
│   │   ├── screener.ts
│   │   ├── nse.ts
│   │   └── news.ts
│   │
│   ├── db/
│   │   ├── schema.sql
│   │   └── migrations/
│   │
│   └── main.tsx
│
├── scripts/                  # Automation scripts
│   ├── evening-workflow.ts
│   ├── morning-workflow.ts
│   └── db-backup.ts
│
├── .env                      # API keys
└── package.json
```

### 2.3 Environment Variables

**Create `.env`:**
```bash
# Angel One API
ANGEL_ONE_API_KEY=your_api_key
ANGEL_ONE_CLIENT_ID=your_client_id
ANGEL_ONE_PASSWORD=your_password

# Screener.in (if API available)
SCREENER_API_KEY=your_key

# News API
NEWS_API_KEY=your_key

# Database
DATABASE_PATH=~/.dexter/dexter.db

# Scheduling
EVENING_WORKFLOW_TIME=20:00
MORNING_WORKFLOW_TIME=09:00
```

---

## 3. Phase 1: Core Scoring (Weeks 1-4)

### Week 1: Database + API Integration

**Goal:** Set up database and fetch market data

**Tasks:**

**1. Create Database Schema:**
```bash
# src/db/schema.sql
sqlite3 ~/.dexter/dexter.db < src/db/schema.sql
```

Use schema from System Design section 4.1

**2. Test Angel One API:**
```typescript
// src/api/angel-one.ts

import { SmartAPI } from 'smartapi-javascript';

export class AngelOneAPI {
    private client: SmartAPI;
    
    constructor() {
        this.client = new SmartAPI({
            api_key: process.env.ANGEL_ONE_API_KEY
        });
    }
    
    async authenticate(): Promise<void> {
        await this.client.generateSession(
            process.env.ANGEL_ONE_CLIENT_ID,
            process.env.ANGEL_ONE_PASSWORD
        );
    }
    
    async getHistoricalData(
        symbol: string,
        days: number = 100
    ): Promise<OHLCV[]> {
        const toDate = new Date();
        const fromDate = new Date();
        fromDate.setDate(fromDate.getDate() - days);
        
        const data = await this.client.getHistoricalData({
            exchange: 'NSE',
            symboltoken: await this.getSymbolToken(symbol),
            interval: 'ONE_DAY',
            fromdate: fromDate.toISOString().split('T')[0],
            todate: toDate.toISOString().split('T')[0]
        });
        
        return data.map(d => ({
            date: d.date,
            open: d.open,
            high: d.high,
            low: d.low,
            close: d.close,
            volume: d.volume
        }));
    }
}
```

**Test:**
```typescript
// scripts/test-api.ts

const api = new AngelOneAPI();
await api.authenticate();

const reliance = await api.getHistoricalData('RELIANCE', 100);
console.log(`Fetched ${reliance.length} days of RELIANCE data`);
console.log('Latest:', reliance[reliance.length - 1]);
```

Run: `bun run scripts/test-api.ts`

**Deliverable:** ✅ Can fetch OHLCV for any NSE stock

---

### Week 2: Scoring Engine

**Goal:** Implement all 6 scoring factors

**Priority Order:**
1. Thrust Power (easiest - just find max candle)
2. At Pivot (find consolidation high)
3. Prior Upmove (calculate rise from base low to pivot)
4. Linearity (measure std dev of daily ranges)
5. EP Detection (gap + catalyst)
6. Sector Strength (fetch sector indices)

**Implementation:**

**Start with simplest:**
```typescript
// src/services/scoring-engine.ts

export class ScoringEngine {
    
    // EASIEST: Thrust Power
    measureThrustPower(ohlcv: OHLCV[]): number {
        const last60 = ohlcv.slice(-60);
        
        const maxCandle = last60.reduce((max, day) => {
            const range = ((day.high - day.low) / day.low) * 100;
            return range > max ? range : max;
        }, 0);
        
        // Scoring
        if (maxCandle >= 8.0) return 1.0;
        if (maxCandle >= 5.0) return 0.5;
        return 0;
    }
    
    // Test with known stock
    async testThrust() {
        const ohlcv = await angelOne.getHistoricalData('RELIANCE', 100);
        const score = this.measureThrustPower(ohlcv);
        console.log('RELIANCE Thrust Power:', score);
    }
}
```

**Build incrementally:**
- Day 1-2: Thrust Power + At Pivot
- Day 3-4: Prior Upmove + Linearity
- Day 5-6: EP Detection + Sector Strength
- Day 7: Full integration + testing

**Test Each Factor:**
```typescript
// scripts/test-scoring.ts

const engine = new ScoringEngine();
const symbols = ['RELIANCE', 'TCS', 'INFY', 'HDFCBANK'];

for (const symbol of symbols) {
    const ohlcv = await angelOne.getHistoricalData(symbol, 100);
    
    console.log(`\n${symbol}:`);
    console.log('  Thrust Power:', engine.measureThrustPower(ohlcv));
    console.log('  Linearity:', engine.measureLinearity(ohlcv));
    console.log('  At Pivot:', engine.checkAtPivot(ohlcv));
    // ... test all factors
}
```

**Deliverable:** ✅ All 6 factors implemented and tested on 10 stocks

---

### Week 3: Market Context

**Goal:** Classify market regime + sector money flow

**Market Regime:**
```typescript
// src/services/market-regime.ts

export class MarketRegimeClassifier {
    
    async classifyRegime(): Promise<MarketRegime> {
        // Fetch Nifty 50
        const nifty = await angelOne.getHistoricalData('NIFTY 50', 200);
        const current = nifty[nifty.length - 1].close;
        
        // Calculate MAs
        const ma50 = this.calculateMA(nifty, 50);
        const ma200 = this.calculateMA(nifty, 200);
        
        // Simple classification
        let regime: 'BULL' | 'CHOPPY' | 'BEAR';
        
        if (current > ma50 && ma50 > ma200) {
            regime = 'BULL';
        } else if (current < ma50 && ma50 < ma200) {
            regime = 'BEAR';
        } else {
            regime = 'CHOPPY';
        }
        
        // Store in DB
        await db.insert('market_context', {
            date: new Date(),
            regime,
            nifty_price: current,
            nifty_ma_50: ma50,
            nifty_ma_200: ma200
        });
        
        return { regime, nifty_price: current };
    }
    
    private calculateMA(ohlcv: OHLCV[], period: number): number {
        const closes = ohlcv.slice(-period).map(d => d.close);
        return closes.reduce((sum, c) => sum + c, 0) / period;
    }
}
```

**Sector Flow (Simplified v1):**
```typescript
// src/services/sector-flow.ts

export class SectorMoneyFlowAnalyzer {
    
    async analyzeSectorFlow(): Promise<SectorFlow[]> {
        const sectors = ['IT', 'Pharma', 'Banking', 'Auto'];
        const results = [];
        
        for (const sector of sectors) {
            // Fetch sector index
            const index = await nseAPI.getSectorIndex(sector);
            
            // Simple classification based on % change
            let strength: 'STRONG' | 'MODERATE' | 'WEAK';
            if (index.change_pct > 1.0) strength = 'STRONG';
            else if (index.change_pct > 0) strength = 'MODERATE';
            else strength = 'WEAK';
            
            results.push({
                sector,
                strength,
                change_pct: index.change_pct
            });
        }
        
        return results;
    }
}
```

**Test:**
```bash
bun run scripts/test-market-context.ts

# Expected output:
# Market Regime: CHOPPY
# Nifty: 22,450 (above 200-DMA, below 50-DMA)
# 
# Sector Flow:
# IT: STRONG (+1.8%)
# Pharma: MODERATE (+0.5%)
# Banking: WEAK (-0.3%)
```

**Deliverable:** ✅ Daily market regime + sector strength classification

---

### Week 4: Focus List Generation

**Goal:** Filter stocks and generate top 3-5 focus list

**Implementation:**
```typescript
// src/services/focus-list-generator.ts

export class FocusListGenerator {
    
    async generateFocusList(): Promise<FocusList> {
        // Get context
        const regime = await marketRegime.classifyRegime();
        const sectors = await sectorFlow.analyzeSectorFlow();
        
        // Get all Priority 0 stocks with scores
        const stocks = await db.query(`
            SELECT * FROM stock_scores
            WHERE priority = 0
            ORDER BY total_score DESC
        `);
        
        // Filter by regime threshold
        const threshold = regime.regime === 'BULL' ? 4.5 :
                         regime.regime === 'CHOPPY' ? 5.0 : 5.5;
        
        const qualified = stocks.filter(s => s.total_score >= threshold);
        
        // Get strong sectors
        const strongSectors = sectors
            .filter(s => s.strength === 'STRONG')
            .map(s => s.sector);
        
        // Prioritize stocks in strong sectors
        const prioritized = qualified.sort((a, b) => {
            // Strong sector first
            const aStrong = strongSectors.includes(a.sector) ? 1 : 0;
            const bStrong = strongSectors.includes(b.sector) ? 1 : 0;
            if (aStrong !== bStrong) return bStrong - aStrong;
            
            // Then by score
            return b.total_score - a.total_score;
        });
        
        // Top 3-5
        const focusList = prioritized.slice(0, 5);
        
        // Store in DB
        await db.insert('focus_lists', {
            date: new Date(),
            regime: regime.regime,
            strong_sectors: JSON.stringify(strongSectors)
        });
        
        return {
            date: new Date(),
            regime: regime.regime,
            focus_stocks: focusList
        };
    }
}
```

**Test with Real Data:**
```typescript
// scripts/test-focus-list.ts

// 1. Import mock Priority 0 list
const mockStocks = ['RELIANCE', 'TCS', 'INFY', 'HDFCBANK', 'WIPRO'];

// 2. Score all stocks
for (const symbol of mockStocks) {
    const ohlcv = await angelOne.getHistoricalData(symbol, 100);
    const score = await scoringEngine.calculateScore(symbol, ohlcv);
    
    await db.insert('stock_scores', {
        symbol,
        priority: 0,
        total_score: score.total,
        ...score.breakdown
    });
}

// 3. Generate focus list
const focusList = await focusListGenerator.generateFocusList();

console.log('FOCUS LIST:');
focusList.focus_stocks.forEach((stock, i) => {
    console.log(`${i+1}. ${stock.symbol} (${stock.total_score})`);
});
```

**Deliverable:** ✅ Evening report showing top 3-5 stocks from Priority 0

---

## 4. Phase 2: Journal & Performance (Weeks 5-7)

### Week 5: Trade Journal

**Goal:** Entry and exit logging forms

**Entry Form Component:**
```typescript
// src/components/journal/EntryForm.tsx

export function EntryForm({ symbol, focusListData }: Props) {
    const [formData, setFormData] = useState({
        entry_price: focusListData.planned_entry || '',
        shares: focusListData.planned_shares || '',
        stop_price: focusListData.planned_stop || '',
        conviction: 'High',
        emotion: 'Confident',
        reasoning: ''
    });
    
    const handleSubmit = async () => {
        await db.insert('trade_journal', {
            symbol,
            entry_date: new Date(),
            entry_price: parseFloat(formData.entry_price),
            shares: parseInt(formData.shares),
            stop_price: parseFloat(formData.stop_price),
            score_at_entry: focusListData.score,
            score_breakdown: JSON.stringify(focusListData.breakdown),
            market_regime: focusListData.regime,
            conviction: formData.conviction,
            emotion: formData.emotion,
            reasoning: formData.reasoning,
            status: 'OPEN'
        });
        
        // Also add to positions table
        await db.insert('positions', {
            symbol,
            entry_price: formData.entry_price,
            shares: formData.shares,
            stop_price: formData.stop_price
        });
    };
    
    return (
        <form onSubmit={handleSubmit}>
            {/* Form fields */}
        </form>
    );
}
```

**Test:**
```bash
# Manually enter 1 mock trade through UI
# Verify it appears in database:

sqlite3 ~/.dexter/dexter.db
> SELECT * FROM trade_journal WHERE symbol = 'RELIANCE';
```

**Deliverable:** ✅ Can log entry and exit for trades

---

### Week 6: Performance Analytics

**Goal:** Calculate win rates by score/factor

**Implementation:**
```typescript
// src/services/performance-validator.ts

export class PerformanceValidator {
    
    async generateReport(
        startDate: Date,
        endDate: Date
    ): Promise<PerformanceReport> {
        // Fetch closed trades
        const trades = await db.query(`
            SELECT * FROM trade_journal
            WHERE status = 'CLOSED'
              AND entry_date BETWEEN ? AND ?
        `, [startDate, endDate]);
        
        if (trades.length < 20) {
            return {
                error: 'Need at least 20 trades for meaningful analysis'
            };
        }
        
        // Overall stats
        const wins = trades.filter(t => t.pnl > 0);
        const winRate = wins.length / trades.length;
        
        // By score range
        const score5_5_6 = trades.filter(t => t.score_at_entry >= 5.5);
        const score5_0_5_4 = trades.filter(t => 
            t.score_at_entry >= 5.0 && t.score_at_entry < 5.5
        );
        
        // By individual factors
        const factorAnalysis = this.analyzeByFactors(trades);
        
        // Generate insights
        const insights = this.generateInsights({
            winRate,
            byScore: {
                high: score5_5_6.filter(t => t.pnl > 0).length / score5_5_6.length,
                medium: score5_0_5_4.filter(t => t.pnl > 0).length / score5_0_5_4.length
            },
            byFactor: factorAnalysis
        });
        
        return {
            overall: { trades: trades.length, win_rate: winRate },
            by_score: { high: score5_5_6.length, medium: score5_0_5_4.length },
            by_factor: factorAnalysis,
            insights
        };
    }
    
    private analyzeByFactors(trades: Trade[]): FactorAnalysis {
        // For each factor, compare win rate when present vs absent
        const epPresent = trades.filter(t => 
            JSON.parse(t.score_breakdown).x_factor.details.ep
        );
        const epAbsent = trades.filter(t => 
            !JSON.parse(t.score_breakdown).x_factor.details.ep
        );
        
        return {
            ep: {
                present_win_rate: this.calcWinRate(epPresent),
                absent_win_rate: this.calcWinRate(epAbsent),
                edge: this.calcWinRate(epPresent) - this.calcWinRate(epAbsent)
            }
            // ... repeat for all factors
        };
    }
    
    private generateInsights(data: any): string[] {
        const insights = [];
        
        if (data.byScore.high > data.byScore.medium + 0.2) {
            insights.push(
                `⭐ YOUR EDGE: 5.5+ scores win ${(data.byScore.high * 100).toFixed(0)}%. Focus here.`
            );
        }
        
        if (data.byFactor.ep.edge > 0.2) {
            insights.push(
                `✓ EP factor adds +${(data.byFactor.ep.edge * 100).toFixed(0)}% win rate`
            );
        }
        
        return insights;
    }
}
```

**Test with Mock Data:**
```typescript
// scripts/seed-mock-trades.ts

const mockTrades = [
    { symbol: 'RELIANCE', score: 5.5, ep: true, pnl: 12000 },
    { symbol: 'TCS', score: 5.0, ep: false, pnl: 8000 },
    { symbol: 'INFY', score: 4.5, ep: false, pnl: -5000 },
    // ... 17 more trades
];

for (const trade of mockTrades) {
    await db.insert('trade_journal', {
        ...trade,
        status: 'CLOSED'
    });
}

// Generate report
const report = await performanceValidator.generateReport(
    new Date('2024-01-01'),
    new Date('2024-03-01')
);

console.log(report.insights);
```

**Deliverable:** ✅ Performance review showing edge/leaks

---

### Week 7: Scoring Evolution

**Goal:** Recommend scoring adjustments based on results

**Implementation:**
```typescript
// src/services/scoring-evolution.ts

export class ScoringEvolutionEngine {
    
    async recommendAdjustments(): Promise<Recommendation[]> {
        const report = await performanceValidator.generateReport(
            /* last 3 months */
        );
        
        const recommendations = [];
        
        // Check each factor for correlation
        for (const [factor, stats] of Object.entries(report.by_factor)) {
            if (stats.edge < 0.05) {
                // No meaningful edge
                recommendations.push({
                    type: 'REMOVE',
                    factor,
                    reason: `${factor} shows no correlation with your wins (${stats.present_win_rate} vs ${stats.absent_win_rate})`,
                    impact: 'Simplify scoring, no loss of edge'
                });
            } else if (stats.edge > 0.3) {
                // Strong edge
                recommendations.push({
                    type: 'INCREASE_WEIGHT',
                    factor,
                    reason: `${factor} adds +${(stats.edge * 100).toFixed(0)}% win rate`,
                    impact: 'Consider increasing points allocation'
                });
            }
        }
        
        return recommendations;
    }
}
```

**Deliverable:** ✅ "Remove RS, increase EP weight" recommendations

---

## 5. Phase 3: Automation (Weeks 8-10)

### Week 8: Evening Workflow (8 PM)

**Goal:** Automate scoring + focus list generation

**Workflow Script:**
```typescript
// scripts/evening-workflow.ts

export async function runEveningWorkflow() {
    console.log('Starting evening workflow...');
    
    try {
        // 1. Check if watchlist imported today
        const lastImport = await db.query(`
            SELECT MAX(imported_at) as last FROM watchlists
        `);
        
        if (!isToday(lastImport)) {
            console.warn('⚠️  No watchlist imported today. Using yesterday\'s.');
        }
        
        // 2. Fetch latest market data
        console.log('Fetching market data...');
        // (Angel One API calls)
        
        // 3. Score all Priority 0 stocks
        console.log('Scoring stocks...');
        const stocks = await db.query(`
            SELECT DISTINCT symbol FROM watchlist_stocks
            WHERE watchlist_id IN (SELECT id FROM watchlists WHERE priority = 0)
        `);
        
        for (const stock of stocks) {
            const ohlcv = await angelOne.getHistoricalData(stock.symbol, 100);
            const score = await scoringEngine.calculateScore(stock.symbol, ohlcv);
            
            await db.insert('stock_scores', {
                symbol: stock.symbol,
                priority: 0,
                ...score
            });
        }
        
        // 4. Analyze market context
        console.log('Analyzing market regime...');
        const regime = await marketRegime.classifyRegime();
        const sectors = await sectorFlow.analyzeSectorFlow();
        
        // 5. Generate focus list
        console.log('Generating focus list...');
        const focusList = await focusListGenerator.generateFocusList();
        
        // 6. Send evening report
        console.log('Sending evening report...');
        await notificationService.sendEveningReport({
            regime,
            sectors,
            focusList
        });
        
        console.log('✓ Evening workflow complete');
        
    } catch (error) {
        console.error('Evening workflow failed:', error);
        // Send error notification
        await notificationService.sendError(error);
    }
}
```

**Schedule with Cron:**
```typescript
// src/main.tsx (or Tauri backend)

import cron from 'node-cron';
import { runEveningWorkflow } from './scripts/evening-workflow';

// Run daily at 8 PM
cron.schedule('0 20 * * *', () => {
    console.log('Cron triggered: Evening workflow');
    runEveningWorkflow();
});
```

**Test:**
```bash
# Manual test
bun run scripts/evening-workflow.ts

# Expected output:
# Starting evening workflow...
# Fetching market data...
# Scoring stocks...
#   RELIANCE: 5.5
#   TCS: 5.0
#   ...
# Analyzing market regime...
#   Regime: CHOPPY
# Generating focus list...
#   Focus: RELIANCE, TCS, HDFCBANK
# Sending evening report...
# ✓ Evening workflow complete
```

**Deliverable:** ✅ Automated evening workflow runs at 8 PM daily

---

### Week 9: Morning Workflow (9 AM)

**Goal:** Check overnight changes, update focus list

**Workflow Script:**
```typescript
// scripts/morning-workflow.ts

export async function runMorningWorkflow() {
    console.log('Starting morning workflow...');
    
    // 1. Get yesterday's focus list
    const yesterday = await db.query(`
        SELECT * FROM focus_lists
        WHERE date = date('now', '-1 day')
    `);
    
    if (!yesterday) {
        console.log('No focus list from yesterday. Skipping.');
        return;
    }
    
    const focusStocks = await db.query(`
        SELECT * FROM focus_list_stocks
        WHERE focus_list_id = ?
    `, [yesterday.id]);
    
    // 2. Check overnight gaps
    const changes = [];
    
    for (const stock of focusStocks) {
        const ohlcv = await angelOne.getHistoricalData(stock.symbol, 2);
        const today = ohlcv[1];
        const yesterday = ohlcv[0];
        
        const gapPct = ((today.open - yesterday.close) / yesterday.close) * 100;
        
        if (Math.abs(gapPct) > 3) {
            changes.push({
                symbol: stock.symbol,
                gap_pct: gapPct,
                direction: gapPct > 0 ? 'UP' : 'DOWN'
            });
        }
    }
    
    // 3. Fetch overnight news
    const newsUpdates = [];
    for (const stock of focusStocks) {
        const news = await newsAPI.getRecentNews(stock.symbol, 1);
        if (news.length > 0) {
            newsUpdates.push({
                symbol: stock.symbol,
                headline: news[0].headline
            });
        }
    }
    
    // 4. Re-validate setups
    const invalidated = [];
    for (const stock of focusStocks) {
        const ohlcv = await angelOne.getHistoricalData(stock.symbol, 100);
        
        // Check if broke below base
        const baseScore = await db.query(`
            SELECT base_strength_details FROM stock_scores
            WHERE symbol = ? ORDER BY scored_at DESC LIMIT 1
        `, [stock.symbol]);
        
        const baseLow = JSON.parse(baseScore.base_strength_details).base_low;
        
        if (ohlcv[ohlcv.length - 1].close < baseLow) {
            invalidated.push({
                symbol: stock.symbol,
                reason: 'Broke below base'
            });
        }
    }
    
    // 5. Send morning update (only if changes)
    if (changes.length > 0 || newsUpdates.length > 0 || invalidated.length > 0) {
        await notificationService.sendMorningUpdate({
            gaps: changes,
            news: newsUpdates,
            invalidated
        });
    } else {
        console.log('No overnight changes. No update sent.');
    }
    
    console.log('✓ Morning workflow complete');
}
```

**Schedule:**
```typescript
cron.schedule('0 9 * * 1-5', () => {  // Mon-Fri only
    console.log('Cron triggered: Morning workflow');
    runMorningWorkflow();
});
```

**Deliverable:** ✅ Morning update sent at 9 AM on market days

---

### Week 10: Setup Invalidation Tracking

**Goal:** Detect when setups break

**Implementation:**
```typescript
// src/services/setup-invalidation.ts

export class SetupInvalidationTracker {
    
    async checkInvalidations(): Promise<Invalidation[]> {
        // Get all scored stocks that are not invalidated
        const activeScores = await db.query(`
            SELECT * FROM stock_scores
            WHERE invalidated_at IS NULL
            ORDER BY scored_at DESC
        `);
        
        const invalidations = [];
        
        for (const score of activeScores) {
            const ohlcv = await angelOne.getHistoricalData(score.symbol, 100);
            const current = ohlcv[ohlcv.length - 1];
            
            // Parse score details
            const breakdown = JSON.parse(score.base_strength_details);
            const baseLow = breakdown.base_low;
            
            // Check break below base
            if (current.close < baseLow) {
                await db.update('stock_scores', score.id, {
                    invalidated_at: new Date(),
                    invalidation_reason: 'Broke below base low'
                });
                
                invalidations.push({
                    symbol: score.symbol,
                    reason: 'Broke below base',
                    price: current.close,
                    base_low: baseLow
                });
            }
            
            // Check fakeout
            const pivot = breakdown.pivot_price;
            if (current.high > pivot && current.close < pivot) {
                await db.update('stock_scores', score.id, {
                    invalidated_at: new Date(),
                    invalidation_reason: 'Fakeout - broke above pivot but closed below'
                });
                
                invalidations.push({
                    symbol: score.symbol,
                    reason: 'Fakeout',
                    pivot,
                    close: current.close
                });
            }
        }
        
        return invalidations;
    }
}
```

**Add to Evening Workflow:**
```typescript
// In evening-workflow.ts, after scoring:

const invalidations = await invalidationTracker.checkInvalidations();

if (invalidations.length > 0) {
    console.log('Invalidations detected:');
    invalidations.forEach(inv => {
        console.log(`  ${inv.symbol}: ${inv.reason}`);
    });
}
```

**Deliverable:** ✅ Automatically detect and flag invalidated setups

---

## 6. Phase 4: Integration (Weeks 11-12)

### Week 11: TradingView CSV Import

**Goal:** Import real Priority 0,1,2,3 watchlists

**UI Component:**
```typescript
// src/components/import/WatchlistImport.tsx

export function WatchlistImport() {
    const [selectedPriority, setSelectedPriority] = useState<0 | 1 | 2 | 3>(0);
    
    const handleFileUpload = async (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;
        
        const importer = new WatchlistImporter();
        const result = await importer.importFromCSV(file, selectedPriority);
        
        if (result.invalid_symbols.length > 0) {
            alert(`Warning: ${result.invalid_symbols.length} invalid symbols`);
            console.log('Invalid symbols:', result.invalid_symbols);
        }
        
        alert(`Imported ${result.imported} stocks to Priority ${selectedPriority}`);
    };
    
    return (
        <div>
            <h2>Import TradingView Watchlist</h2>
            
            <select 
                value={selectedPriority}
                onChange={(e) => setSelectedPriority(parseInt(e.target.value))}
            >
                <option value={0}>Priority 0 (Focus)</option>
                <option value={1}>Priority 1 (Near Ready)</option>
                <option value={2}>Priority 2 (Building)</option>
                <option value={3}>Priority 3 (Watching)</option>
            </select>
            
            <input 
                type="file" 
                accept=".csv"
                onChange={handleFileUpload}
            />
            
            <p>Export your watchlist from TradingView as CSV, then upload here.</p>
        </div>
    );
}
```

**Test with Real Data:**
1. Export your actual Priority 0 list from TradingView
2. Upload via UI
3. Verify stocks appear in database
4. Run evening workflow manually
5. Check focus list generated correctly

**Deliverable:** ✅ Can import your real TradingView watchlists

---

### Week 12: Polish + End-to-End Testing

**Goal:** Bug fixes, documentation, full workflow test

**Testing Checklist:**
- [ ] Import real watchlist (all 4 priorities)
- [ ] Evening workflow runs automatically at 8 PM
- [ ] Receives evening report email/notification
- [ ] Morning workflow runs at 9 AM next day
- [ ] Log a real trade entry
- [ ] Log a real trade exit
- [ ] View performance review (after 20 trades)
- [ ] Check scoring evolution recommendations (after 30 trades)
- [ ] Database backup runs daily

**Documentation:**
- User guide (how to use Dexter)
- Setup guide (install, configure APIs)
- Troubleshooting (common errors)

**Deliverable:** ✅ Production-ready system with docs

---

## 7. Testing Checklist

### Unit Tests (80% Coverage Target)

**Scoring Engine:**
- [ ] Thrust Power calculation
- [ ] Linearity measurement
- [ ] EP detection (with/without catalyst)
- [ ] Sector strength comparison
- [ ] All factor scoring functions

**Market Context:**
- [ ] Regime classification (Bull/Choppy/Bear)
- [ ] Breadth calculation
- [ ] Sector money flow analysis

**Focus List:**
- [ ] Score threshold filtering
- [ ] Sector prioritization
- [ ] Sorting logic

### Integration Tests

**Full Workflow:**
- [ ] Import watchlist → Score → Focus list
- [ ] Enter trade → Log journal → Update positions
- [ ] Exit trade → Calculate P&L → Update performance
- [ ] Evening workflow end-to-end
- [ ] Morning workflow end-to-end

### Manual Testing

**Real Data:**
- [ ] Import your actual TradingView watchlists
- [ ] Score 50+ real stocks (check results make sense)
- [ ] Generate focus list (are top stocks reasonable?)
- [ ] Log 5 mock trades
- [ ] Review performance report

---

## 8. Deployment

### Build Production App

**Tauri Build:**
```bash
# Build for your platform
bun tauri build

# macOS
# Output: src-tauri/target/release/bundle/dmg/dexter-trading.dmg

# Windows
# Output: src-tauri/target/release/bundle/msi/dexter-trading.msi

# Linux
# Output: src-tauri/target/release/bundle/appimage/dexter-trading.AppImage
```

### First-Time Setup

**1. Install App:**
- macOS: Drag to Applications
- Windows: Run installer
- Linux: Make AppImage executable

**2. Configure API Keys:**
```bash
# First run opens settings
# Enter:
#   - Angel One API Key
#   - Angel One Client ID
#   - Angel One Password
#   - (Optional) News API Key
```

**3. Import Initial Watchlist:**
- Export from TradingView
- Import via Dexter UI
- Select Priority level

**4. Run First Evening Workflow:**
```bash
# Manually trigger first run
# Or wait until 8 PM
```

**5. Verify:**
- Check focus list generated
- Review scores (do they make sense?)
- Adjust if needed

### Daily Usage

**Evening (8 PM):**
- Automated workflow runs
- Receive focus list notification
- Review top 3-5 stocks (5 minutes)

**Morning (9 AM):**
- Receive morning update (if changes)
- Review adjustments (2 minutes)

**During Market:**
- Stock triggers → Log entry (30 seconds)
- Exit position → Log exit (30 seconds)

**Weekly:**
- Review performance dashboard
- Check insights

---

## Quick Start Commands

```bash
# Development
bun install
bun tauri dev

# Test Scoring
bun run scripts/test-scoring.ts

# Test Evening Workflow
bun run scripts/evening-workflow.ts

# Test Morning Workflow
bun run scripts/morning-workflow.ts

# Build Production
bun tauri build

# Run Tests
bun test

# Database Backup
bun run scripts/db-backup.ts
```

---

**END OF IMPLEMENTATION GUIDE v4.0**

*This guide provides a practical, week-by-week roadmap to build Dexter Trading v4.0. Start with Week 1 (Database + APIs) and build incrementally. Each week has clear deliverables and tests to verify progress.*
