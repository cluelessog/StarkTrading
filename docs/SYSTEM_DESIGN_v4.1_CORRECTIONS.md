# System Design v4.1 - Key Corrections

**Use with:** SYSTEM_DESIGN_Dexter_Trading_v4.0.md  
**What Changed:** Binary scoring system (12 subsections, threshold 8+)

## Critical Architecture Changes

### 1. Scoring Engine - Two-Phase Workflow

**Phase 1: Algorithmic Scoring (Automated)**
```typescript
async calculateAlgorithmicScore(symbol: string): Promise<Score> {
    // Returns partial score with 8 algorithmic factors
    // Discretionary factors = null (needs user review)
    // Status: 'PARTIAL'
}
```

**Phase 2: Discretionary Completion (User Review)**
```typescript
completeScore(partialScore: Score, userInputs: DiscretionaryInputs): Score {
    // User confirms 5 discretionary factors
    // Final score calculated
    // Status: 'COMPLETE'
}
```

### 2. Score Interface Update

```typescript
interface Score {
    total_score: number;  // Out of 12.5 (not 6.0)
    status: 'PARTIAL' | 'COMPLETE';  // NEW
    
    algorithmic_factors: {
        ep_catalyst: 0 | 1;
        sector_strength: 0 | 1;
        high_rs: 0 | 1;
        ipo: 0 | 1;
        thrust_power: 0 | 1;
        pivot_location: 0 | 0.5 | 1.0;  // Graduated
        pattern_quality: 0 | 1;
        pivot_level: 0 | 1;
    };
    
    discretionary_factors: {  // NEW
        linearity: null | 0 | 1;
        not_pivot_cutter: null | 0 | 1;
        aoi: null | 0 | 1;
        hve_hvy: null | 0 | 1;
        hvq: null | 0 | 1;
    };
}
```

### 3. Database Schema Changes

```sql
CREATE TABLE stock_scores (
    -- Overall
    total_score REAL,  -- Out of 12.5
    status TEXT,  -- 'PARTIAL' or 'COMPLETE'
    
    -- 8 algorithmic factors
    ep_catalyst INTEGER,
    sector_strength INTEGER,
    high_rs INTEGER,
    ipo INTEGER,
    thrust_power INTEGER,
    pivot_location REAL,  -- 0, 0.5, or 1.0
    pattern_quality INTEGER,
    pivot_level INTEGER,
    
    -- 5 discretionary factors (NEW)
    linearity INTEGER,
    not_pivot_cutter INTEGER,
    aoi INTEGER,
    hve_hvy INTEGER,
    hvq INTEGER,
    
    reviewed_at DATETIME  -- NEW
);
```

### 4. NEW Component: DiscretionaryReviewService

Handles user review workflow for 5 discretionary factors.

### 5. Focus List Generator Update

```typescript
// Only include COMPLETE scores
const stocks = await db.query(`
    SELECT * FROM stock_scores
    WHERE status = 'COMPLETE'
      AND total_score >= 8.0  -- Changed from 5.0
`);
```

### 6. Evening Workflow Update

1. Calculate algorithmic scores (PARTIAL status)
2. Flag stocks needing review
3. Generate focus list from COMPLETE scores only
4. Notify user: "X stocks ready, Y need review"

## Key Differences Summary

| Aspect | v4.0 | v4.1 |
|--------|------|------|
| Max Score | 6.0 | 12.5 |
| Threshold | 5+ | 8+ |
| Workflow | Fully automated | Hybrid (auto + review) |
| Status | Single | 'PARTIAL'/'COMPLETE' |
| Pivot Location | Binary | Graduated (0/0.5/1.0) |

---

**For full implementation details, see PRD_Dexter_Trading_v4.1_CORRECTED.md**
