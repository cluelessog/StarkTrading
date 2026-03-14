import type { MBIData } from '../models/market.js';
import type { RegimeResult } from './regime-classifier.js';

// ---------------------------------------------------------------------------
// Regime display helpers
// ---------------------------------------------------------------------------

const REGIME_LABELS: Record<string, string> = {
  STRONG_BULL: 'STRONG BULL',
  BULL: 'BULL',
  CAUTIOUS: 'CAUTIOUS',
  CHOPPY: 'CHOPPY',
  BEAR: 'BEAR',
};

const CONFIDENCE_LABELS: Record<string, string> = {
  full: 'EM-based',
  breadth_only: 'Breadth-only (no EM)',
  stale: 'Stale data',
};

// ---------------------------------------------------------------------------
// MBI Dashboard Formatter
// ---------------------------------------------------------------------------

/**
 * Format a full MBI dashboard for CLI display.
 * Shows regime, EM, confidence, source, and breadth indicators.
 */
export function formatMBIDashboard(data: MBIData, regime: RegimeResult): string {
  const lines: string[] = [];

  lines.push(`Regime:     ${REGIME_LABELS[regime.regime] ?? regime.regime}`);
  lines.push(`EM:         ${regime.em != null ? regime.em.toFixed(1) : 'N/A'}`);
  lines.push(`Confidence: ${CONFIDENCE_LABELS[regime.confidence] ?? regime.confidence}`);
  lines.push(`Source:     ${data.source}`);
  lines.push(`Date:       ${data.date}`);
  lines.push(`Freshness:  ${data.dataFreshness}`);

  lines.push('');
  lines.push(formatBreadthSummary(data));

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Breadth Summary Formatter
// ---------------------------------------------------------------------------

/**
 * Format breadth indicators from MBI data for display.
 */
export function formatBreadthSummary(data: MBIData): string {
  const lines: string[] = [];

  lines.push('Breadth Indicators:');
  lines.push(`  52W High %:   ${fmtPct(data.pct52WH)}`);
  lines.push(`  52W Low %:    ${fmtPct(data.pct52WL)}`);
  lines.push(`  Ratio 4:5:    ${data.ratio4_5?.toFixed(2) ?? 'N/A'}`);

  if (data.pctAbove20SMA != null) {
    lines.push(`  > 20 SMA %:   ${fmtPct(data.pctAbove20SMA)}`);
  }
  if (data.pctAbove50SMA != null) {
    lines.push(`  > 50 SMA %:   ${fmtPct(data.pctAbove50SMA)}`);
  }
  if (data.pctAbove200SMA != null) {
    lines.push(`  > 200 SMA %:  ${fmtPct(data.pctAbove200SMA)}`);
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtPct(value: number | undefined): string {
  if (value == null) return 'N/A';
  return `${value.toFixed(1)}%`;
}
