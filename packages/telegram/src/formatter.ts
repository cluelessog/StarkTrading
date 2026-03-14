import type { ToolResult } from './tool-registry.js';
import { escapeMarkdownV2 } from './telegram-platform.js';
import type { ScoreResult } from '@stark/core/scoring/engine.js';
import type { TradeJournalEntry } from '@stark/core/db/queries.js';
import type { PortfolioHeat } from '@stark/core/journal/portfolio-heat.js';

const MAX_LINES = 40;

export class TelegramFormatter {
  format(toolName: string, result: ToolResult): string {
    try {
      switch (toolName) {
        case 'score':
          return this.formatScore(result);
        case 'focus':
          return this.formatFocusList(result);
        case 'heat':
          return this.formatHeat(result);
        case 'trades':
          return this.formatTrades(result);
        case 'help':
          return this.formatHelp(result);
        default:
          return this.formatDefault(result);
      }
    } catch {
      return escapeMarkdownV2(result.summary || 'Done.');
    }
  }

  private formatScore(result: ToolResult): string {
    if (!result.data) return escapeMarkdownV2(result.summary);

    const r = result.data as ScoreResult;
    const lines: string[] = [];
    const statusIcon = r.status === 'COMPLETE' ? '✓' : '~';
    lines.push(`*${escapeMarkdownV2(r.symbol)}* \\[${escapeMarkdownV2(r.status)}\\] ${escapeMarkdownV2(statusIcon)}`);
    lines.push(`Score: *${escapeMarkdownV2(String(r.totalScore))}*/${escapeMarkdownV2(String(r.maxPossibleScore))}`);
    if (r.status === 'COMPLETE') {
      lines.push(`Algo: ${escapeMarkdownV2(String(r.algorithmicScore))}  Disc: ${escapeMarkdownV2(String(r.discretionaryScore))}`);
    }
    lines.push('');

    let shown = 0;
    for (const f of r.factors) {
      if (shown >= MAX_LINES - 4) {
        lines.push(escapeMarkdownV2(`... (${r.factors.length - shown} more factors)`));
        break;
      }
      const mark = f.score > 0 ? '✓' : '✗';
      const scoreStr = f.score === 1 ? '1' : f.score === 0 ? '0' : f.score.toFixed(1);
      const degraded = f.degraded ? ' \\[degraded\\]' : '';
      lines.push(`${escapeMarkdownV2(mark)} ${escapeMarkdownV2(f.factorName)}: ${escapeMarkdownV2(scoreStr)}/${escapeMarkdownV2(String(f.maxScore))}${degraded}`);
      lines.push(`  _${escapeMarkdownV2(f.reasoning.slice(0, 120))}_`);
      shown += 2;
    }

    return lines.join('\n');
  }

  private formatFocusList(result: ToolResult): string {
    if (!result.data) return escapeMarkdownV2(result.summary);

    const rows = result.data as Array<{ symbol: string; total_score: number; max_possible_score: number; status: string }>;
    if (rows.length === 0) return escapeMarkdownV2('No focus stocks. Run evening first.');

    const lines: string[] = ['*Focus List*', ''];
    const display = rows.slice(0, 10);
    for (const row of display) {
      lines.push(`• ${escapeMarkdownV2(row.symbol)}: ${escapeMarkdownV2(String(row.total_score))}/${escapeMarkdownV2(String(row.max_possible_score))} \\[${escapeMarkdownV2(row.status)}\\]`);
    }
    if (rows.length > 10) {
      lines.push(escapeMarkdownV2(`... (${rows.length - 10} more)`));
    }
    return lines.join('\n');
  }

  private formatHeat(result: ToolResult): string {
    if (!result.data) return escapeMarkdownV2(result.summary);

    const h = result.data as PortfolioHeat;
    const statusIcon = h.status === 'OK' ? '✓' : h.status === 'WARNING' ? '⚠' : '🚨';
    const lines: string[] = [
      `*Portfolio Heat* ${escapeMarkdownV2(statusIcon)}`,
      `Heat: *${escapeMarkdownV2(String(h.heatPct))}%* \\[${escapeMarkdownV2(h.status)}\\]`,
      `Total risk: Rs ${escapeMarkdownV2(h.totalRisk.toLocaleString('en-IN'))}`,
      `Capital:    Rs ${escapeMarkdownV2(h.totalCapital.toLocaleString('en-IN'))}`,
      '',
    ];

    if (h.positions.length === 0) {
      lines.push(escapeMarkdownV2('No open positions.'));
    } else {
      lines.push(`*Positions \\(${escapeMarkdownV2(String(h.positions.length))}\\)*`);
      const display = h.positions.slice(0, MAX_LINES - 5);
      for (const p of display) {
        lines.push(`• ${escapeMarkdownV2(p.symbol)}: Rs ${escapeMarkdownV2(p.riskAmount.toLocaleString('en-IN'))} \\(${escapeMarkdownV2(p.pctOfCapital.toFixed(1))}%\\)`);
      }
      if (h.positions.length > display.length) {
        lines.push(escapeMarkdownV2(`... (${h.positions.length - display.length} more)`));
      }
    }
    return lines.join('\n');
  }

  private formatTrades(result: ToolResult): string {
    if (!result.data) return escapeMarkdownV2(result.summary);

    const trades = result.data as TradeJournalEntry[];
    if (trades.length === 0) return escapeMarkdownV2('No trades found.');

    const lines: string[] = [`*Trades \\(${escapeMarkdownV2(String(trades.length))}\\)*`, ''];
    const display = trades.slice(0, 8);
    for (const t of display) {
      const statusIcon = t.status === 'OPEN' ? '●' : '○';
      lines.push(`${escapeMarkdownV2(statusIcon)} *${escapeMarkdownV2(t.symbol)}* \\[${escapeMarkdownV2(t.status)}\\]`);
      lines.push(`  Entry: Rs ${escapeMarkdownV2(String(t.entryPrice))} × ${escapeMarkdownV2(String(t.shares))} on ${escapeMarkdownV2(t.entryDate)}`);
      if (t.status === 'CLOSED' && t.exitPrice != null) {
        const pnlSign = (t.pnl ?? 0) >= 0 ? '+' : '';
        lines.push(`  Exit: Rs ${escapeMarkdownV2(String(t.exitPrice))} | P&L: ${escapeMarkdownV2(pnlSign + String(t.pnl ?? 0))} | ${escapeMarkdownV2(String(t.rMultiple ?? 0))}R`);
      }
    }
    if (trades.length > display.length) {
      lines.push(escapeMarkdownV2(`... (${trades.length - display.length} more)`));
    }
    return lines.join('\n');
  }

  private formatHelp(result: ToolResult): string {
    const lines: string[] = ['*Available Commands*', ''];
    const commands = result.data as string[] | null;
    if (Array.isArray(commands)) {
      for (const cmd of commands) {
        lines.push(`• ${escapeMarkdownV2(cmd)}`);
      }
    } else {
      lines.push(escapeMarkdownV2(result.summary));
    }
    return lines.join('\n');
  }

  private formatDefault(result: ToolResult): string {
    const text = result.summary || JSON.stringify(result.data, null, 2);
    const lines = text.split('\n');
    if (lines.length > MAX_LINES) {
      const truncated = lines.slice(0, MAX_LINES).join('\n');
      return escapeMarkdownV2(`${truncated}\n... (${lines.length - MAX_LINES} more lines)`);
    }
    return escapeMarkdownV2(text);
  }
}
