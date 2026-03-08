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
  it('isEnabled returns false when disabled', () => {
    const db = createMockDb();
    const config: LLMConfig = {
      enabled: false,
      geminiKey: 'key',
      perplexityKey: 'key',
      cacheResponses: true,
      cacheTtlHours: 24,
    };
    const service = new LLMServiceImpl(config, db);
    expect(service.isEnabled(config)).toBe(false);
  });

  it('isEnabled returns false when no keys', () => {
    const db = createMockDb();
    const config: LLMConfig = {
      enabled: true,
      cacheResponses: true,
      cacheTtlHours: 24,
    };
    const service = new LLMServiceImpl(config, db);
    expect(service.isEnabled(config)).toBe(false);
  });

  it('isEnabled returns true when enabled with keys', () => {
    const db = createMockDb();
    const config: LLMConfig = {
      enabled: true,
      geminiKey: 'key',
      cacheResponses: true,
      cacheTtlHours: 24,
    };
    const service = new LLMServiceImpl(config, db);
    expect(service.isEnabled(config)).toBe(true);
  });

  it('analyzeOHLCV returns fallback when no Gemini key', async () => {
    const db = createMockDb();
    const config: LLMConfig = {
      enabled: true,
      cacheResponses: true,
      cacheTtlHours: 24,
    };
    const service = new LLMServiceImpl(config, db);
    const result = await service.analyzeOHLCV('test', [], config);
    expect(result.score).toBe(0);
    expect(result.reasoning).toContain('not configured');
  });

  it('research returns fallback when no Perplexity key', async () => {
    const db = createMockDb();
    const config: LLMConfig = {
      enabled: true,
      cacheResponses: true,
      cacheTtlHours: 24,
    };
    const service = new LLMServiceImpl(config, db);
    const result = await service.research('test', config);
    expect(result.answer).toContain('not configured');
  });
});
