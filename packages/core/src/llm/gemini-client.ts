import type { LLMCache } from './llm-cache.js';

export interface LLMAnalysisResult {
  score: number;
  reasoning: string;
  confidence: number;
  cached: boolean;
  providerUsed?: string;
}

export class GeminiClient {
  private apiKey: string;
  private baseUrl = 'https://generativelanguage.googleapis.com/v1beta';

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
        return { ...parsed, cached: true, providerUsed: 'gemini' };
      } catch {
        // Cache corrupted, re-fetch
      }
    }

    // Call Gemini API
    const url = `${this.baseUrl}/models/gemini-2.0-flash:generateContent?key=${this.apiKey}`;
    const body = {
      contents: [
        {
          parts: [
            {
              text: `${fullPrompt}\n\nRespond in JSON format: {"score": <number 0 or 1 or 0.5>, "reasoning": "<brief explanation>", "confidence": <number 0-1>}`,
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.1,
        responseMimeType: 'application/json',
      },
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini API error (${response.status}): ${errorText}`);
    }

    const json: any = await response.json();
    const text: string =
      json?.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}';

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
    this.cache.set(promptHash, JSON.stringify(normalized), 'gemini-2.0-flash');

    return { ...normalized, cached: false, providerUsed: 'gemini' };
  }
}
