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
  canAnalyze(): boolean;
  canResearch(): boolean;
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

  getAnalysisProvider(): string {
    if (this.claude) return 'claude';
    if (this.gemini) return 'gemini';
    return 'none';
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
