import { randomUUID } from 'node:crypto';

export interface ScoringContext {
  sessionId: string;
  startedAt: number;
  symbols: string[];
  apiCalls: Record<string, number>;
  cacheHits: number;
  cacheMisses: number;
  llmCalls: number;
  errors: Array<{ symbol: string; factor: string; error: string }>;
  degradedFactors: Array<{ symbol: string; factorId: string }>;
  completedAt?: number;
}

export function createScoringContext(symbols: string[]): ScoringContext {
  return {
    sessionId: randomUUID(),
    startedAt: Date.now(),
    symbols,
    apiCalls: {},
    cacheHits: 0,
    cacheMisses: 0,
    llmCalls: 0,
    errors: [],
    degradedFactors: [],
  };
}

export function trackDegradedFactor(
  ctx: ScoringContext,
  symbol: string,
  factorId: string,
): void {
  ctx.degradedFactors.push({ symbol, factorId });
}

export function trackApiCall(ctx: ScoringContext, service: string): void {
  ctx.apiCalls[service] = (ctx.apiCalls[service] ?? 0) + 1;
}

export function trackCacheHit(ctx: ScoringContext): void {
  ctx.cacheHits++;
}

export function trackCacheMiss(ctx: ScoringContext): void {
  ctx.cacheMisses++;
}

export function trackError(
  ctx: ScoringContext,
  symbol: string,
  factor: string,
  error: string,
): void {
  ctx.errors.push({ symbol, factor, error });
}

export function completeContext(ctx: ScoringContext): void {
  ctx.completedAt = Date.now();
}
