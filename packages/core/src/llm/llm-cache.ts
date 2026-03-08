import { createHash } from 'node:crypto';
import type { DatabaseAdapter } from '../db/adapter.js';

interface CachedResponse {
  prompt_hash: string;
  response: string;
  model: string;
  created_at: string;
}

export class LLMCache {
  constructor(
    private db: DatabaseAdapter,
    private cacheTtlHours: number,
  ) {}

  hashPrompt(prompt: string): string {
    return createHash('sha256').update(prompt).digest('hex');
  }

  get(promptHash: string): CachedResponse | null {
    return this.db.queryOne<CachedResponse>(
      `SELECT * FROM llm_cache WHERE prompt_hash = ? AND datetime(created_at, '+' || ? || ' hours') > datetime('now')`,
      [promptHash, this.cacheTtlHours],
    );
  }

  set(promptHash: string, response: string, model: string): void {
    this.db.execute(
      `INSERT OR REPLACE INTO llm_cache (prompt_hash, response, model) VALUES (?, ?, ?)`,
      [promptHash, response, model],
    );
  }

  clear(): void {
    this.db.execute(`DELETE FROM llm_cache`, []);
  }

  clearExpired(): void {
    this.db.execute(
      `DELETE FROM llm_cache WHERE datetime(created_at, '+' || ? || ' hours') <= datetime('now')`,
      [this.cacheTtlHours],
    );
  }
}
