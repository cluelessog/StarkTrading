import { describe, it, expect } from 'bun:test';
import {
  calculatePearsonCorrelation,
  analyzeMBIScoreCorrelation,
  detectRegimeTransitions,
} from '../src/mbi/analysis.js';

// ---------------------------------------------------------------------------
// calculatePearsonCorrelation
// ---------------------------------------------------------------------------

describe('calculatePearsonCorrelation', () => {
  it('returns 1.0 for perfectly correlated data', () => {
    const x = [1, 2, 3, 4, 5];
    const y = [2, 4, 6, 8, 10];
    const r = calculatePearsonCorrelation(x, y);
    expect(r).toBeCloseTo(1.0, 10);
  });

  it('returns -1.0 for perfectly inversely correlated data', () => {
    const x = [1, 2, 3, 4, 5];
    const y = [10, 8, 6, 4, 2];
    const r = calculatePearsonCorrelation(x, y);
    expect(r).toBeCloseTo(-1.0, 10);
  });

  it('returns 0 for uncorrelated data', () => {
    // Symmetric around mean — zero correlation
    const x = [1, 2, 3, 4, 5];
    const y = [3, 1, 3, 1, 3];
    const r = calculatePearsonCorrelation(x, y);
    expect(r).toBeCloseTo(0, 10);
  });

  it('returns 0 for empty arrays', () => {
    expect(calculatePearsonCorrelation([], [])).toBe(0);
  });

  it('returns 0 for single element', () => {
    expect(calculatePearsonCorrelation([1], [2])).toBe(0);
  });

  it('returns 0 when one array has zero variance', () => {
    const x = [5, 5, 5, 5];
    const y = [1, 2, 3, 4];
    expect(calculatePearsonCorrelation(x, y)).toBe(0);
  });

  it('handles arrays of different lengths (uses shorter)', () => {
    const x = [1, 2, 3, 4, 5, 6, 7];
    const y = [2, 4, 6];
    const r = calculatePearsonCorrelation(x, y);
    // Should only correlate first 3 elements: [1,2,3] vs [2,4,6]
    expect(r).toBeCloseTo(1.0, 10);
  });

  it('calculates moderate positive correlation', () => {
    // EM values and scores — not perfectly correlated
    const em = [18, 15, 20, 12, 22, 10, 25, 8];
    const scores = [7.5, 6.0, 8.0, 5.5, 8.5, 4.0, 9.0, 3.5];
    const r = calculatePearsonCorrelation(em, scores);
    expect(r).toBeGreaterThan(0.9);
    expect(r).toBeLessThanOrEqual(1.0);
  });
});

// ---------------------------------------------------------------------------
// analyzeMBIScoreCorrelation
// ---------------------------------------------------------------------------

describe('analyzeMBIScoreCorrelation', () => {
  it('returns correlation result with interpretation', () => {
    const em = [18, 15, 20, 12, 22, 10];
    const scores = [7.5, 6.0, 8.0, 5.5, 8.5, 4.0];
    const result = analyzeMBIScoreCorrelation(em, scores);
    expect(result.pearsonR).toBeGreaterThan(0.9);
    expect(result.sampleSize).toBe(6);
    expect(result.interpretation).toContain('strong');
    expect(result.interpretation).toContain('positive');
  });

  it('returns insufficient data interpretation for small samples', () => {
    const result = analyzeMBIScoreCorrelation([10, 15], [5, 6]);
    expect(result.sampleSize).toBe(2);
    expect(result.interpretation).toContain('Insufficient');
  });

  it('handles empty inputs', () => {
    const result = analyzeMBIScoreCorrelation([], []);
    expect(result.pearsonR).toBe(0);
    expect(result.sampleSize).toBe(0);
  });

  it('detects negative correlation', () => {
    const em = [25, 20, 15, 10, 5];
    const scores = [3, 5, 7, 9, 11];
    const result = analyzeMBIScoreCorrelation(em, scores);
    expect(result.pearsonR).toBeCloseTo(-1.0, 10);
    expect(result.interpretation).toContain('negative');
  });

  it('detects no meaningful correlation', () => {
    const em = [15, 20, 15, 20, 15];
    const scores = [8, 8, 8, 8, 8];
    const result = analyzeMBIScoreCorrelation(em, scores);
    expect(result.interpretation).toContain('No meaningful');
  });
});

// ---------------------------------------------------------------------------
// detectRegimeTransitions
// ---------------------------------------------------------------------------

describe('detectRegimeTransitions', () => {
  it('detects regime changes', () => {
    const history = [
      { date: '2026-03-01', regime: 'BULL' },
      { date: '2026-03-02', regime: 'BULL' },
      { date: '2026-03-03', regime: 'CAUTIOUS' },
      { date: '2026-03-04', regime: 'CAUTIOUS' },
      { date: '2026-03-05', regime: 'CHOPPY' },
    ];
    const transitions = detectRegimeTransitions(history);
    expect(transitions).toHaveLength(2);
    expect(transitions[0]).toEqual({
      date: '2026-03-03',
      from: 'BULL',
      to: 'CAUTIOUS',
    });
    expect(transitions[1]).toEqual({
      date: '2026-03-05',
      from: 'CAUTIOUS',
      to: 'CHOPPY',
    });
  });

  it('returns empty array when no transitions', () => {
    const history = [
      { date: '2026-03-01', regime: 'BULL' },
      { date: '2026-03-02', regime: 'BULL' },
      { date: '2026-03-03', regime: 'BULL' },
    ];
    expect(detectRegimeTransitions(history)).toHaveLength(0);
  });

  it('returns empty array for empty history', () => {
    expect(detectRegimeTransitions([])).toHaveLength(0);
  });

  it('returns empty array for single entry', () => {
    expect(detectRegimeTransitions([{ date: '2026-03-01', regime: 'BULL' }])).toHaveLength(0);
  });

  it('detects every-day changes', () => {
    const history = [
      { date: '2026-03-01', regime: 'BEAR' },
      { date: '2026-03-02', regime: 'CHOPPY' },
      { date: '2026-03-03', regime: 'CAUTIOUS' },
      { date: '2026-03-04', regime: 'BULL' },
    ];
    const transitions = detectRegimeTransitions(history);
    expect(transitions).toHaveLength(3);
  });
});
