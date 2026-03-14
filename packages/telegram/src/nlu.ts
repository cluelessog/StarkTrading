import type { LLMService } from '@stark/core/llm/llm-service.js';
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

    // Phase 2: LLM fallback
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
