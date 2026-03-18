import type { LLMService } from '../llm/llm-service.js';
import type { ToolRegistry } from './tool-registry.js';

export interface ParsedIntent {
  command: string;
  args: Record<string, string>;
  confidence: number;
}

export class NLU {
  private lastSymbolByChat: Map<string, string> = new Map();

  constructor(
    private registry: ToolRegistry,
    private llmService: LLMService | null,
  ) {}

  async parse(
    text: string,
    chatId: string,
    history: Array<{ role: string; message: string }>,
  ): Promise<ParsedIntent> {
    // Phase 1: regex exact match
    const exactMatch = this.exactMatch(text, chatId);
    if (exactMatch) return exactMatch;

    // Phase 2: fuzzy match (no LLM needed)
    const fuzzyResult = this.fuzzyMatch(text);
    if (fuzzyResult) return fuzzyResult;

    // Phase 3: LLM fallback
    if (this.llmService?.canComplete()) {
      return this.llmFallback(text, chatId, history);
    }

    return { command: 'unknown', args: {}, confidence: 0 };
  }

  private exactMatch(text: string, chatId: string): ParsedIntent | null {
    const t = text.trim();
    const lower = t.toLowerCase();

    // score SYMBOL
    const scoreMatch = t.match(/^score\s+([A-Za-z0-9_-]+)$/i);
    if (scoreMatch) {
      const symbol = scoreMatch[1].toUpperCase();
      this.lastSymbolByChat.set(chatId, symbol);
      return { command: 'score', args: { symbol }, confidence: 1 };
    }

    // focus list
    if (/^(focus|focus list|my focus)$/i.test(lower)) {
      return { command: 'focus', args: {}, confidence: 1 };
    }

    // heat
    if (/^(heat|my heat|show heat|portfolio heat)$/i.test(lower)) {
      return { command: 'heat', args: {}, confidence: 1 };
    }

    // trades
    if (/^(open trades|my trades|trades|positions)$/i.test(lower)) {
      return { command: 'trades', args: { filter: 'open' }, confidence: 1 };
    }
    if (/^closed trades$/i.test(lower)) {
      return { command: 'trades', args: { filter: 'closed' }, confidence: 1 };
    }

    // market
    if (/^(market|market overview|market context)$/i.test(lower)) {
      return { command: 'market', args: {}, confidence: 1 };
    }

    // morning/evening
    if (/^morning$/i.test(lower)) return { command: 'morning', args: {}, confidence: 1 };
    if (/^evening$/i.test(lower)) return { command: 'evening', args: {}, confidence: 1 };

    // sync
    if (/^sync$/i.test(lower)) return { command: 'sync', args: {}, confidence: 1 };

    // status
    if (/^(status|my status)$/i.test(lower)) return { command: 'status', args: {}, confidence: 1 };

    // performance
    if (/^(performance|my performance|stats)$/i.test(lower)) {
      return { command: 'performance', args: {}, confidence: 1 };
    }

    // logs
    if (/^(logs|recent logs)$/i.test(lower)) return { command: 'logs', args: {}, confidence: 1 };

    // help
    if (/^(help|commands|\?)$/i.test(lower)) return { command: 'help', args: {}, confidence: 1 };

    // entry SYMBOL PRICE SHARES [STOP] [CONVICTION]
    const entryMatch = t.match(/^entry\s+([A-Za-z0-9_-]+)\s+(\d+(?:\.\d+)?)\s+(\d+)(?:\s+(\d+(?:\.\d+)?))?(?:\s+(high|medium|low))?$/i);
    if (entryMatch) {
      const symbol = entryMatch[1].toUpperCase();
      this.lastSymbolByChat.set(chatId, symbol);
      return {
        command: 'entry',
        args: {
          symbol,
          price: entryMatch[2],
          shares: entryMatch[3],
          ...(entryMatch[4] ? { stop: entryMatch[4] } : {}),
          ...(entryMatch[5] ? { conviction: entryMatch[5].toUpperCase() } : {}),
        },
        confidence: 1,
      };
    }

    // exit SYMBOL PRICE [REASON]
    const exitMatch = t.match(/^exit\s+([A-Za-z0-9_-]+)\s+(\d+(?:\.\d+)?)(?:\s+(stopped|target|discretion|invalidated))?$/i);
    if (exitMatch) {
      const symbol = exitMatch[1].toUpperCase();
      this.lastSymbolByChat.set(chatId, symbol);
      return {
        command: 'exit',
        args: {
          symbol,
          price: exitMatch[2],
          ...(exitMatch[3] ? { reason: exitMatch[3].toUpperCase() } : {}),
        },
        confidence: 1,
      };
    }

    // override with pronoun resolution: "override its linearity to 1"
    const overrideMatch = t.match(/^override\s+(its|that|this)\s+(\w+)\s+(?:to\s+)?(\d+(?:\.\d+)?)$/i);
    if (overrideMatch) {
      const lastSymbol = this.lastSymbolByChat.get(chatId);
      if (lastSymbol) {
        return {
          command: 'review',
          args: { symbol: lastSymbol, factor: overrideMatch[2], value: overrideMatch[3] },
          confidence: 0.9,
        };
      }
    }

    return null;
  }

  private fuzzyMatch(text: string): ParsedIntent | null {
    const lower = text.toLowerCase().trim();

    // Natural language aliases (check first — more specific than single-word match)
    const aliases: Record<string, { command: string; args: Record<string, string> }> = {
      'show me my trades': { command: 'trades', args: { filter: 'open' } },
      'show my trades': { command: 'trades', args: { filter: 'open' } },
      'show open trades': { command: 'trades', args: { filter: 'open' } },
      'show closed trades': { command: 'trades', args: { filter: 'closed' } },
      'all trades': { command: 'trades', args: { filter: 'all' } },
      'show all trades': { command: 'trades', args: { filter: 'all' } },
      'what is my heat': { command: 'heat', args: {} },
      'risk exposure': { command: 'heat', args: {} },
      'how is the market': { command: 'market', args: {} },
      'market status': { command: 'market', args: {} },
      'what should i buy': { command: 'focus', args: {} },
      'what to buy': { command: 'focus', args: {} },
      'show performance': { command: 'performance', args: {} },
      'how am i doing': { command: 'performance', args: {} },
      'my performance': { command: 'performance', args: {} },
      'pnl': { command: 'performance', args: {} },
      'profit and loss': { command: 'performance', args: {} },
      'run morning': { command: 'morning', args: {} },
      'run evening': { command: 'evening', args: {} },
      'show logs': { command: 'logs', args: {} },
      'show status': { command: 'status', args: {} },
      'mbi': { command: 'mbi-analyze', args: {} },
      'market breadth': { command: 'mbi-analyze', args: {} },
      'evolution': { command: 'evolve', args: {} },
      'factor evolution': { command: 'evolve', args: {} },
    };

    for (const [phrase, result] of Object.entries(aliases)) {
      if (lower.includes(phrase)) {
        return { command: result.command, args: result.args, confidence: 0.8 };
      }
    }

    // Single-word Levenshtein match against command names (generic fallback)
    const commandNames = this.registry.getAll().map(t => t.name);
    const words = lower.split(/\s+/);
    for (const word of words) {
      for (const cmd of commandNames) {
        if (this.levenshtein(word, cmd) <= 1 && word.length >= 3) {
          return { command: cmd, args: {}, confidence: 0.7 };
        }
      }
    }

    // Natural language entry/exit patterns
    // "enter reliance at 2850 with stop at 2780" or "buy reliance at 2850 stop 2780 100 shares"
    const nlEntryMatch = lower.match(/(?:enter|buy)\s+([a-z0-9_-]+)(?:\s+at)?\s+(\d+(?:\.\d+)?)(?:\s+(?:with\s+)?stop(?:\s+at)?\s+(\d+(?:\.\d+)?))?(?:\s+(\d+)\s*shares?)?/i);
    if (nlEntryMatch) {
      const args: Record<string, string> = {
        symbol: nlEntryMatch[1].toUpperCase(),
        price: nlEntryMatch[2],
      };
      if (nlEntryMatch[3]) args.stop = nlEntryMatch[3];
      if (nlEntryMatch[4]) args.shares = nlEntryMatch[4];
      return { command: 'entry', args, confidence: 0.8 };
    }

    // "sell reliance at 2950" or "exit reliance at 2950 target"
    const nlExitMatch = lower.match(/(?:sell|close)\s+([a-z0-9_-]+)(?:\s+at)?\s+(\d+(?:\.\d+)?)(?:\s+(stopped|target|discretion|invalidated))?/i);
    if (nlExitMatch) {
      const args: Record<string, string> = {
        symbol: nlExitMatch[1].toUpperCase(),
        price: nlExitMatch[2],
      };
      if (nlExitMatch[3]) args.reason = nlExitMatch[3].toUpperCase();
      return { command: 'exit', args, confidence: 0.8 };
    }

    // "score reliance" variant - more flexible than exact match
    const nlScoreMatch = lower.match(/(?:score|analyze|check)\s+([a-z0-9_-]+)/i);
    if (nlScoreMatch) {
      return { command: 'score', args: { symbol: nlScoreMatch[1].toUpperCase() }, confidence: 0.8 };
    }

    return null;
  }

  private levenshtein(a: string, b: string): number {
    const m = a.length, n = b.length;
    const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        dp[i][j] = a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
    return dp[m][n];
  }

  private async llmFallback(
    text: string,
    chatId: string,
    history: Array<{ role: string; message: string }>,
  ): Promise<ParsedIntent> {
    const toolDescriptions = this.registry.getToolDescriptions();
    const lastSymbol = this.lastSymbolByChat.get(chatId);
    const historyText = history
      .slice(-5)
      .map((h) => `${h.role}: ${h.message}`)
      .join('\n');

    const prompt = `You are an intent classifier for a stock trading bot. Available commands:\n${toolDescriptions}\n\nConversation history:\n${historyText}\n${lastSymbol ? `Last referenced symbol: ${lastSymbol}` : ''}\n\nUser message: "${text}"\n\nRespond ONLY with JSON: {"command": "<command_name>", "args": {"key": "value"}, "confidence": <0-1>}`;

    try {
      const response = await this.llmService!.complete(prompt);
      // Strip markdown code fences if present
      const cleaned = response.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
      const parsed = JSON.parse(cleaned) as { command?: string; args?: Record<string, string>; confidence?: number };
      if (parsed.args?.symbol) {
        this.lastSymbolByChat.set(chatId, parsed.args.symbol);
      }
      return {
        command: parsed.command ?? 'unknown',
        args: parsed.args ?? {},
        confidence: parsed.confidence ?? 0.5,
      };
    } catch {
      return { command: 'unknown', args: {}, confidence: 0 };
    }
  }
}
