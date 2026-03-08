import type { OHLCVBar } from '../models/intervals.js';
import type { LLMConfig } from '../config/index.js';
import type { DatabaseAdapter } from '../db/adapter.js';
import { LLMCache } from './llm-cache.js';
import { GeminiClient, type LLMAnalysisResult } from './gemini-client.js';
import { PerplexityClient, type ResearchResult } from './perplexity-client.js';

// ---------------------------------------------------------------------------
// LLM Service interface
// ---------------------------------------------------------------------------

export interface LLMService {
  analyzeOHLCV(
    prompt: string,
    bars: OHLCVBar[],
    config: LLMConfig,
  ): Promise<LLMAnalysisResult>;

  research(query: string, config: LLMConfig): Promise<ResearchResult>;

  isEnabled(config: LLMConfig): boolean;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class LLMServiceImpl implements LLMService {
  private gemini: GeminiClient | null = null;
  private perplexity: PerplexityClient | null = null;
  private cache: LLMCache;

  constructor(
    private config: LLMConfig,
    db: DatabaseAdapter,
  ) {
    this.cache = new LLMCache(db, config.cacheTtlHours ?? 24);

    if (config.geminiKey) {
      this.gemini = new GeminiClient(config.geminiKey, this.cache);
    }
    if (config.perplexityKey) {
      this.perplexity = new PerplexityClient(config.perplexityKey, this.cache);
    }
  }

  isEnabled(config: LLMConfig): boolean {
    return config.enabled && !!(config.geminiKey || config.perplexityKey);
  }

  async analyzeOHLCV(
    prompt: string,
    bars: OHLCVBar[],
    _config: LLMConfig,
  ): Promise<LLMAnalysisResult> {
    if (!this.gemini) {
      return {
        score: 0,
        reasoning: 'Gemini API key not configured',
        confidence: 0,
        cached: false,
      };
    }

    // Send OHLCV as structured data
    const ohlcvSummary = bars.map((b) => ({
      date: b.date,
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
      volume: b.volume,
    }));

    return this.gemini.analyze(prompt, ohlcvSummary);
  }

  async research(query: string, _config: LLMConfig): Promise<ResearchResult> {
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
