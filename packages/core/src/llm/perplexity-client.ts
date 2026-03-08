import type { LLMCache } from './llm-cache.js';

export interface ResearchResult {
  answer: string;
  sources: string[];
  cached: boolean;
}

export class PerplexityClient {
  private apiKey: string;
  private baseUrl = 'https://api.perplexity.ai';

  constructor(
    apiKey: string,
    private cache: LLMCache,
  ) {
    this.apiKey = apiKey;
  }

  async research(query: string): Promise<ResearchResult> {
    const promptHash = this.cache.hashPrompt(query);

    // Check cache
    const cached = this.cache.get(promptHash);
    if (cached) {
      try {
        const parsed = JSON.parse(cached.response);
        return { ...parsed, cached: true };
      } catch {
        // Cache corrupted, re-fetch
      }
    }

    // Call Perplexity API
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: 'sonar',
        messages: [
          {
            role: 'system',
            content: 'You are a stock market research assistant focused on Indian NSE stocks. Provide concise, factual answers.',
          },
          { role: 'user', content: query },
        ],
        max_tokens: 500,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Perplexity API error (${response.status}): ${errorText}`);
    }

    const json = await response.json();
    const answer = json?.choices?.[0]?.message?.content ?? '';
    const sources: string[] = json?.citations ?? [];

    const result = { answer, sources };

    // Cache the result
    this.cache.set(promptHash, JSON.stringify(result), 'sonar');

    return { ...result, cached: false };
  }
}
