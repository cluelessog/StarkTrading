import { describe, it, expect, beforeEach, mock } from 'bun:test';
import { LLMCache } from '../src/llm/llm-cache.js';
import { ClaudeClient } from '../src/llm/claude-client.js';
import type { DatabaseAdapter } from '../src/db/adapter.js';

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
// ClaudeClient tests
// ---------------------------------------------------------------------------

describe('ClaudeClient', () => {
  let db: ReturnType<typeof createMockDb>;
  let cache: LLMCache;

  beforeEach(() => {
    db = createMockDb();
    cache = new LLMCache(db, 24);
  });

  it('parses a successful Claude response', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  score: 1,
                  reasoning: 'Strong uptrend with volume confirmation',
                  confidence: 0.85,
                }),
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    ) as typeof fetch;

    try {
      const client = new ClaudeClient('test-key', cache);
      const result = await client.analyze('Is this linear?', { bars: [] });

      expect(result.score).toBe(1);
      expect(result.reasoning).toBe('Strong uptrend with volume confirmation');
      expect(result.confidence).toBe(0.85);
      expect(result.cached).toBe(false);
      expect(result.providerUsed).toBe('claude');
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
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  score: 0.5,
                  reasoning: 'Borderline pattern',
                  confidence: 0.7,
                }),
              },
            ],
          }),
          { status: 200 },
        ),
      );
    }) as typeof fetch;

    try {
      const client = new ClaudeClient('test-key', cache);
      const result1 = await client.analyze('same prompt');
      const result2 = await client.analyze('same prompt');

      expect(result1.cached).toBe(false);
      expect(result2.cached).toBe(true);
      expect(result2.providerUsed).toBe('claude');
      expect(fetchCount).toBe(1); // Only one actual API call
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
      const client = new ClaudeClient('test-key', cache);
      await expect(client.analyze('test')).rejects.toThrow('Claude API error');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('handles unparseable response text', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            content: [{ type: 'text', text: 'This is not JSON at all' }],
          }),
          { status: 200 },
        ),
      ),
    ) as typeof fetch;

    try {
      const client = new ClaudeClient('test-key', cache);
      const result = await client.analyze('test');

      expect(result.score).toBe(0);
      expect(result.reasoning).toContain('Unparseable');
      expect(result.confidence).toBe(0);
      expect(result.providerUsed).toBe('claude');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('normalizes out-of-range confidence', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            content: [
              {
                type: 'text',
                text: JSON.stringify({ score: 1, reasoning: 'Test', confidence: 1.5 }),
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    ) as typeof fetch;

    try {
      const client = new ClaudeClient('test-key', cache);
      const result = await client.analyze('test');

      expect(result.confidence).toBe(1); // Clamped to max 1
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
