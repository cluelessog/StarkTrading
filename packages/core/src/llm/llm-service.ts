import type { OHLCVBar } from '../models/intervals.js';
import type { LLMConfig } from '../config/index.js';
import type { DatabaseAdapter } from '../db/adapter.js';
import { LLMCache } from './llm-cache.js';
import { ClaudeClient } from './claude-client.js';
import { GeminiClient, type LLMAnalysisResult } from './gemini-client.js';
import { PerplexityClient, type ResearchResult } from './perplexity-client.js';

// ---------------------------------------------------------------------------
// LLM Service interface
// ---------------------------------------------------------------------------

export interface LLMService {
  analyzeOHLCV(prompt: string, bars: OHLCVBar[]): Promise<LLMAnalysisResult>;
  research(query: string): Promise<ResearchResult>;
  complete(prompt: string): Promise<string>;
  canAnalyze(): boolean;
  canResearch(): boolean;
  canComplete(): boolean;
  getAnalysisProvider(): string;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class LLMServiceImpl implements LLMService {
  private claude: ClaudeClient | null = null;
  private gemini: GeminiClient | null = null;
  private perplexity: PerplexityClient | null = null;
  private cache: LLMCache;

  constructor(
    private config: LLMConfig,
    db: DatabaseAdapter,
  ) {
    this.cache = new LLMCache(db, config.cacheTtlHours ?? 24);

    if (config.anthropicKey) {
      this.claude = new ClaudeClient(config.anthropicKey, this.cache);
    }
    if (config.geminiKey) {
      this.gemini = new GeminiClient(config.geminiKey, this.cache);
    }
    if (config.perplexityKey) {
      this.perplexity = new PerplexityClient(config.perplexityKey, this.cache);
    }
  }

  canAnalyze(): boolean {
    return this.claude !== null || this.gemini !== null;
  }

  canResearch(): boolean {
    return this.perplexity !== null;
  }

  canComplete(): boolean {
    return this.gemini !== null || this.claude !== null;
  }

  getAnalysisProvider(): string {
    if (this.claude) return 'claude';
    if (this.gemini) return 'gemini';
    return 'none';
  }

  // Gemini-first (unlike analyzeOHLCV which is Claude-first) -- NLU classification is
  // latency-sensitive and low-complexity, making Gemini 2.0 Flash the better choice for speed/cost.
  async complete(prompt: string): Promise<string> {
    if (!this.gemini && !this.claude) {
      throw new Error('No LLM provider configured for complete()');
    }

    // Try Gemini first (faster/cheaper for text classification)
    if (this.gemini) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${this.config.geminiKey}`;
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.1 },
          }),
        });
        if (!response.ok) {
          throw new Error(`Gemini API error (${response.status})`);
        }
        const json = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
        return json?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
      } catch (geminiError) {
        // Fall through to Claude if available
        if (!this.claude) throw geminiError;
      }
    }

    // Claude fallback
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.config.anthropicKey!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      throw new Error(`Claude API error (${response.status})`);
    }

    const json = (await response.json()) as { content?: Array<{ text?: string }> };
    return json?.content?.[0]?.text ?? '';
  }

  async analyzeOHLCV(
    prompt: string,
    bars: OHLCVBar[],
  ): Promise<LLMAnalysisResult> {
    if (!this.claude && !this.gemini) {
      return {
        score: 0,
        reasoning: 'No analysis provider configured',
        confidence: 0,
        cached: false,
        providerUsed: 'none',
      };
    }

    // Send OHLCV as structured data
    const ohlcvSummary = bars.map((b) => ({
      date: b.timestamp,
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
      volume: b.volume,
    }));

    // Claude first, Gemini fallback
    if (this.claude) {
      try {
        return await this.claude.analyze(prompt, ohlcvSummary);
      } catch (claudeError) {
        // Cascade to Gemini if available
        if (this.gemini) {
          return await this.gemini.analyze(prompt, ohlcvSummary);
        }
        throw claudeError;
      }
    }

    // Gemini only
    return this.gemini!.analyze(prompt, ohlcvSummary);
  }

  async research(query: string): Promise<ResearchResult> {
    if (!this.perplexity) {
      return {
        answer: 'Perplexity API key not configured',
        sources: [],
        cached: false,
      };
    }

    return this.perplexity.research(query);
  }
}
