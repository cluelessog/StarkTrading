import type { LLMCache } from './llm-cache.js';
import type { LLMAnalysisResult } from './gemini-client.js';

export class ClaudeClient {
  private apiKey: string;
  private baseUrl = 'https://api.anthropic.com/v1/messages';

  constructor(
    apiKey: string,
    private cache: LLMCache,
  ) {
    this.apiKey = apiKey;
  }

  async analyze(prompt: string, data?: unknown): Promise<LLMAnalysisResult> {
    const fullPrompt = data
      ? `${prompt}\n\nData:\n${JSON.stringify(data, null, 2)}`
      : prompt;

    const promptHash = this.cache.hashPrompt(fullPrompt);

    // Check cache
    const cached = this.cache.get(promptHash);
    if (cached) {
      try {
        const parsed = JSON.parse(cached.response);
        return { ...parsed, cached: true, providerUsed: 'claude' };
      } catch {
        // Cache corrupted, re-fetch
      }
    }

    const response = await fetch(this.baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        system: 'You are a stock chart analysis assistant focused on Indian NSE stocks. Respond ONLY with valid JSON in this format: {"score": <number 0 or 0.5 or 1>, "reasoning": "<brief explanation>", "confidence": <number 0-1>}',
        messages: [
          { role: 'user', content: fullPrompt },
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Claude API error (${response.status}): ${errorText}`);
    }

    const json = (await response.json()) as { content?: Array<{ text?: string }> };
    const text = json?.content?.[0]?.text ?? '{}';

    let result: { score: number; reasoning: string; confidence: number };
    try {
      result = JSON.parse(text);
    } catch {
      result = { score: 0, reasoning: `Unparseable response: ${text}`, confidence: 0 };
    }

    // Normalize
    const normalized = {
      score: typeof result.score === 'number' ? result.score : 0,
      reasoning: result.reasoning ?? 'No reasoning provided',
      confidence: typeof result.confidence === 'number' ? Math.min(1, Math.max(0, result.confidence)) : 0.5,
    };

    // Cache the result
    this.cache.set(promptHash, JSON.stringify(normalized), 'claude-sonnet-4-20250514');

    return { ...normalized, cached: false, providerUsed: 'claude' };
  }
}
