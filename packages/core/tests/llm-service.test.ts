import { describe, it, expect, beforeEach, mock } from 'bun:test';
import { LLMCache } from '../src/llm/llm-cache.js';
import { GeminiClient } from '../src/llm/gemini-client.js';
import { PerplexityClient } from '../src/llm/perplexity-client.js';
import { LLMServiceImpl } from '../src/llm/llm-service.js';
import type { DatabaseAdapter } from '../src/db/adapter.js';
import type { LLMConfig } from '../src/config/index.js';

// ---------------------------------------------------------------------------
// Mock DatabaseAdapter
// ---------------------------------------------------------------------------

function createMockDb(): DatabaseAdapter & { rows: Map<string, unknown> } {
  const rows = new Map<string, unknown>();
  return {
    rows,
    execute(sql: string, params: unknown[] = []) {
      if (sql.includes('INSERT OR REPLACE')) {
        rows.set(params[0] as string, {
          prompt_hash: params[0],
          response: params[1],
          model: params[2],
          created_at: new Date().toISOString(),
        });
      }
      if (sql.includes('DELETE FROM llm_cache') && !params.length) {
        rows.clear();
      }
    },
    execMulti() {},
    query<T>(_sql: string, _params: unknown[] = []): T[] {
      return [] as T[];
    },
    queryOne<T>(sql: string, params: unknown[] = []): T | null {
      if (sql.includes('llm_cache') && params[0]) {
        const row = rows.get(params[0] as string);
        return (row as T) ?? null;
      }
      return null;
    },
    transaction<T>(fn: () => T): T {
      return fn();
    },
    close() {},
  };
}

// ---------------------------------------------------------------------------
// LLMCache tests
// ---------------------------------------------------------------------------

describe('LLMCache', () => {
  let db: ReturnType<typeof createMockDb>;
  let cache: LLMCache;

  beforeEach(() => {
    db = createMockDb();
    cache = new LLMCache(db, 24);
  });

  it('hashes prompts deterministically', () => {
    const hash1 = cache.hashPrompt('test prompt');
    const hash2 = cache.hashPrompt('test prompt');
    const hash3 = cache.hashPrompt('different prompt');
    expect(hash1).toBe(hash2);
    expect(hash1).not.toBe(hash3);
    expect(hash1).toHaveLength(64); // SHA-256 hex
  });

  it('stores and retrieves cached responses', () => {
    const hash = cache.hashPrompt('test');
    cache.set(hash, '{"score":1}', 'gemini');
    const result = cache.get(hash);
    expect(result).not.toBeNull();
    expect(result!.response).toBe('{"score":1}');
    expect(result!.model).toBe('gemini');
  });

  it('returns null for non-existent entries', () => {
    const result = cache.get('nonexistent');
    expect(result).toBeNull();
  });

  it('clears all entries', () => {
    const hash = cache.hashPrompt('test');
    cache.set(hash, '{}', 'gemini');
    cache.clear();
    expect(cache.get(hash)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// GeminiClient tests
// ---------------------------------------------------------------------------

describe('GeminiClient', () => {
  let db: ReturnType<typeof createMockDb>;
  let cache: LLMCache;

  beforeEach(() => {
    db = createMockDb();
    cache = new LLMCache(db, 24);
  });

  it('parses a successful Gemini response', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: JSON.stringify({
                        score: 1,
                        reasoning: 'Smooth uptrend',
                        confidence: 0.9,
                      }),
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    ) as typeof fetch;

    try {
      const client = new GeminiClient('test-key', cache);
      const result = await client.analyze('Is this linear?', { bars: [] });

      expect(result.score).toBe(1);
      expect(result.reasoning).toBe('Smooth uptrend');
      expect(result.confidence).toBe(0.9);
      expect(result.cached).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('returns cached result on second call', async () => {
    const originalFetch = globalThis.fetch;
    let fetchCount = 0;
    globalThis.fetch = mock(() => {
      fetchCount++;
      return Promise.resolve(
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: JSON.stringify({
                        score: 1,
                        reasoning: 'Cached',
                        confidence: 0.8,
                      }),
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200 },
        ),
      );
    }) as typeof fetch;

    try {
      const client = new GeminiClient('test-key', cache);
      const result1 = await client.analyze('same prompt');
      const result2 = await client.analyze('same prompt');

      expect(result1.cached).toBe(false);
      expect(result2.cached).toBe(true);
      expect(fetchCount).toBe(1); // Only one actual API call
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('handles API errors gracefully', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response('Internal Server Error', { status: 500 })),
    ) as typeof fetch;

    try {
      const client = new GeminiClient('test-key', cache);
      await expect(client.analyze('test')).rejects.toThrow('Gemini API error');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

// ---------------------------------------------------------------------------
// PerplexityClient tests
// ---------------------------------------------------------------------------

describe('PerplexityClient', () => {
  let db: ReturnType<typeof createMockDb>;
  let cache: LLMCache;

  beforeEach(() => {
    db = createMockDb();
    cache = new LLMCache(db, 24);
  });

  it('parses a successful Perplexity response', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: 'RELIANCE reported strong Q3 earnings with 15% revenue growth.',
                },
              },
            ],
            citations: ['https://example.com/reliance-earnings'],
          }),
          { status: 200 },
        ),
      ),
    ) as typeof fetch;

    try {
      const client = new PerplexityClient('test-key', cache);
      const result = await client.research('RELIANCE recent catalysts');

      expect(result.answer).toContain('RELIANCE');
      expect(result.sources).toHaveLength(1);
      expect(result.cached).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('returns cached result on second call', async () => {
    const originalFetch = globalThis.fetch;
    let fetchCount = 0;
    globalThis.fetch = mock(() => {
      fetchCount++;
      return Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: 'Cached answer' } }],
            citations: [],
          }),
          { status: 200 },
        ),
      );
    }) as typeof fetch;

    try {
      const client = new PerplexityClient('test-key', cache);
      await client.research('same query');
      const result2 = await client.research('same query');

      expect(result2.cached).toBe(true);
      expect(fetchCount).toBe(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('handles API errors gracefully', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response('Unauthorized', { status: 401 })),
    ) as typeof fetch;

    try {
      const client = new PerplexityClient('test-key', cache);
      await expect(client.research('test')).rejects.toThrow('Perplexity API error');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

// ---------------------------------------------------------------------------
// LLMServiceImpl tests
// ---------------------------------------------------------------------------

describe('LLMServiceImpl', () => {
  it('canAnalyze returns false when no analysis keys', () => {
    const db = createMockDb();
    const config: LLMConfig = {
      enabled: true,
      perplexityKey: 'key',
      cacheResponses: true,
      cacheTtlHours: 24,
    };
    const service = new LLMServiceImpl(config, db);
    expect(service.canAnalyze()).toBe(false);
  });

  it('canAnalyze returns true with gemini key', () => {
    const db = createMockDb();
    const config: LLMConfig = {
      enabled: true,
      geminiKey: 'key',
      cacheResponses: true,
      cacheTtlHours: 24,
    };
    const service = new LLMServiceImpl(config, db);
    expect(service.canAnalyze()).toBe(true);
  });

  it('canAnalyze returns true with anthropic key', () => {
    const db = createMockDb();
    const config: LLMConfig = {
      enabled: true,
      anthropicKey: 'key',
      cacheResponses: true,
      cacheTtlHours: 24,
    };
    const service = new LLMServiceImpl(config, db);
    expect(service.canAnalyze()).toBe(true);
  });

  it('canResearch returns false when no perplexity key', () => {
    const db = createMockDb();
    const config: LLMConfig = {
      enabled: true,
      geminiKey: 'key',
      cacheResponses: true,
      cacheTtlHours: 24,
    };
    const service = new LLMServiceImpl(config, db);
    expect(service.canResearch()).toBe(false);
  });

  it('canResearch returns true with perplexity key', () => {
    const db = createMockDb();
    const config: LLMConfig = {
      enabled: true,
      perplexityKey: 'key',
      cacheResponses: true,
      cacheTtlHours: 24,
    };
    const service = new LLMServiceImpl(config, db);
    expect(service.canResearch()).toBe(true);
  });

  it('getAnalysisProvider returns claude when anthropic key set', () => {
    const db = createMockDb();
    const config: LLMConfig = {
      enabled: true,
      anthropicKey: 'key',
      geminiKey: 'key2',
      cacheResponses: true,
      cacheTtlHours: 24,
    };
    const service = new LLMServiceImpl(config, db);
    expect(service.getAnalysisProvider()).toBe('claude');
  });

  it('getAnalysisProvider returns gemini when only gemini key set', () => {
    const db = createMockDb();
    const config: LLMConfig = {
      enabled: true,
      geminiKey: 'key',
      cacheResponses: true,
      cacheTtlHours: 24,
    };
    const service = new LLMServiceImpl(config, db);
    expect(service.getAnalysisProvider()).toBe('gemini');
  });

  it('getAnalysisProvider returns none when no keys', () => {
    const db = createMockDb();
    const config: LLMConfig = {
      enabled: true,
      cacheResponses: true,
      cacheTtlHours: 24,
    };
    const service = new LLMServiceImpl(config, db);
    expect(service.getAnalysisProvider()).toBe('none');
  });

  it('analyzeOHLCV returns fallback when no analysis provider', async () => {
    const db = createMockDb();
    const config: LLMConfig = {
      enabled: true,
      cacheResponses: true,
      cacheTtlHours: 24,
    };
    const service = new LLMServiceImpl(config, db);
    const result = await service.analyzeOHLCV('test', []);
    expect(result.score).toBe(0);
    expect(result.reasoning).toContain('No analysis provider configured');
  });

  it('research returns fallback when no Perplexity key', async () => {
    const db = createMockDb();
    const config: LLMConfig = {
      enabled: true,
      cacheResponses: true,
      cacheTtlHours: 24,
    };
    const service = new LLMServiceImpl(config, db);
    const result = await service.research('test');
    expect(result.answer).toContain('not configured');
  });

  it('canComplete returns true when gemini key is configured', () => {
    const db = createMockDb();
    const config: LLMConfig = {
      enabled: true,
      geminiKey: 'key',
      cacheResponses: true,
      cacheTtlHours: 24,
    };
    const service = new LLMServiceImpl(config, db);
    expect(service.canComplete()).toBe(true);
  });

  it('canComplete returns true when anthropic key is configured', () => {
    const db = createMockDb();
    const config: LLMConfig = {
      enabled: true,
      anthropicKey: 'key',
      cacheResponses: true,
      cacheTtlHours: 24,
    };
    const service = new LLMServiceImpl(config, db);
    expect(service.canComplete()).toBe(true);
  });

  it('canComplete returns false when no keys configured', () => {
    const db = createMockDb();
    const config: LLMConfig = {
      enabled: true,
      cacheResponses: true,
      cacheTtlHours: 24,
    };
    const service = new LLMServiceImpl(config, db);
    expect(service.canComplete()).toBe(false);
  });

  it('complete() calls Gemini API and returns text', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [{ text: '{"command":"score","args":{"symbol":"RELIANCE"}}' }],
                },
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    ) as typeof fetch;

    try {
      const db = createMockDb();
      const config: LLMConfig = {
        enabled: true,
        geminiKey: 'test-key',
        cacheResponses: true,
        cacheTtlHours: 24,
      };
      const service = new LLMServiceImpl(config, db);
      const result = await service.complete('classify this: score RELIANCE');
      expect(result).toContain('score');
      expect(result).toContain('RELIANCE');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('complete() falls back to Claude when Gemini fails', async () => {
    const originalFetch = globalThis.fetch;
    let callCount = 0;
    globalThis.fetch = mock((url: string | URL | Request) => {
      callCount++;
      const urlStr = typeof url === 'string' ? url : url.toString();
      if (urlStr.includes('googleapis')) {
        return Promise.resolve(new Response('Error', { status: 500 }));
      }
      // Claude fallback
      return Promise.resolve(
        new Response(
          JSON.stringify({
            content: [{ text: 'Claude fallback response' }],
          }),
          { status: 200 },
        ),
      );
    }) as typeof fetch;

    try {
      const db = createMockDb();
      const config: LLMConfig = {
        enabled: true,
        geminiKey: 'gemini-key',
        anthropicKey: 'claude-key',
        cacheResponses: true,
        cacheTtlHours: 24,
      };
      const service = new LLMServiceImpl(config, db);
      const result = await service.complete('test prompt');
      expect(result).toBe('Claude fallback response');
      expect(callCount).toBe(2); // Gemini failed, then Claude succeeded
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('complete() throws when no provider configured', async () => {
    const db = createMockDb();
    const config: LLMConfig = {
      enabled: true,
      cacheResponses: true,
      cacheTtlHours: 24,
    };
    const service = new LLMServiceImpl(config, db);
    await expect(service.complete('test')).rejects.toThrow('No LLM provider configured');
  });
});
