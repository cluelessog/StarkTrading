import { loadConfig } from '@stark/core/config/index.js';
import { createDatabase } from '@stark/core/db/index.js';
import { SessionManager } from '@stark/core/auth/index.js';
import { LLMServiceImpl } from '@stark/core/llm/index.js';
import { ScoringEngine } from '@stark/core/scoring/engine.js';
import { createDefaultRegistry } from '@stark/core/scoring/registry.js';
import { logger } from '@stark/core/log/index.js';
import { MBIDataManager } from '@stark/core/mbi/data-manager.js';
import { getNifty50Constituents } from '@stark/core/market/nifty-constituents.js';
import { BreadthCalculator } from '@stark/core/market/breadth-calculator.js';
import { ChartinkClient } from '@stark/core/api/chartink.js';
import type { StarkConfig } from '@stark/core/config/index.js';
import type { DatabaseAdapter } from '@stark/core/db/adapter.js';
import type { Queries } from '@stark/core/db/queries.js';
import type { DataProvider } from '@stark/core/api/data-provider.js';
import type { LLMService } from '@stark/core/llm/index.js';
import type { Logger } from '@stark/core/log/logger.js';

export interface CommandContext {
  config: StarkConfig;
  db: DatabaseAdapter;
  queries: Queries;
  provider: DataProvider;
  llmService: LLMService | null;
  engine: ScoringEngine;
  logger: Logger;
  mbiManager: MBIDataManager;
}

export interface PersistentCommandContext extends CommandContext {
  dispose(): void;
  refreshAuth(): Promise<void>;
  isHealthy(): boolean;
}

/**
 * Create a fully-initialized command context.
 * Handles config loading, database creation, authentication, LLM setup, and engine creation.
 */
export async function createCommandContext(): Promise<CommandContext> {
  const config = loadConfig();
  const { db, queries } = createDatabase();

  // Auto-authenticate
  const sessionManager = new SessionManager();
  const provider = await sessionManager.ensureAuthenticated(config);

  // LLM service (optional)
  let llmService: LLMService | null = null;
  if (config.llm?.enabled && (config.llm.anthropicKey || config.llm.geminiKey || config.llm.perplexityKey)) {
    llmService = new LLMServiceImpl(config.llm, db);
  }

  // Scoring engine with LLM integration
  const registry = createDefaultRegistry();
  const engine = new ScoringEngine(provider, db, registry, llmService ?? undefined);

  // MBI data manager with breadth calculator fallback
  const nifty50 = getNifty50Constituents();
  const breadthCalc = new BreadthCalculator(provider, db, {
    universe: 'NIFTY50',
    nifty50Constituents: nifty50,
  });
  // Chartink client (optional secondary fallback for MBI)
  const chartinkClient = config.chartink?.enabled !== false && config.chartink
    ? new ChartinkClient({
        dashboardId: config.chartink.dashboardId ?? '291317',
        timeoutMs: config.chartink.timeoutMs ?? 10000,
      })
    : undefined;

  const mbiManager = new MBIDataManager(
    db,
    { sheetId: config.sheetId },
    breadthCalc,
    chartinkClient,
  );

  return { config, db, queries, provider, llmService, engine, logger, mbiManager };
}

/**
 * Create a persistent command context for long-running processes (bot, scheduler).
 * Caches all dependencies and supports re-authentication and health checks.
 */
export async function createPersistentCommandContext(): Promise<PersistentCommandContext> {
  const config = loadConfig();
  const { db, queries } = createDatabase();
  const sessionManager = new SessionManager();

  let provider = await sessionManager.ensureAuthenticated(config);

  let llmService: LLMService | null = null;
  if (config.llm?.enabled && (config.llm.anthropicKey || config.llm.geminiKey || config.llm.perplexityKey)) {
    llmService = new LLMServiceImpl(config.llm, db);
  }

  const registry = createDefaultRegistry();
  const nifty50 = getNifty50Constituents();

  let engine = new ScoringEngine(provider, db, registry, llmService ?? undefined);
  let breadthCalc = new BreadthCalculator(provider, db, {
    universe: 'NIFTY50',
    nifty50Constituents: nifty50,
  });
  const chartinkClient = config.chartink?.enabled !== false && config.chartink
    ? new ChartinkClient({
        dashboardId: config.chartink.dashboardId ?? '291317',
        timeoutMs: config.chartink.timeoutMs ?? 10000,
      })
    : undefined;

  let mbiManager = new MBIDataManager(db, { sheetId: config.sheetId }, breadthCalc, chartinkClient);

  let disposed = false;

  return {
    config,
    db,
    queries,
    provider,
    llmService,
    engine,
    logger,
    mbiManager,

    dispose() {
      if (!disposed) {
        db.close();
        disposed = true;
      }
    },

    async refreshAuth() {
      if (!provider.isAuthenticated()) {
        provider = await sessionManager.ensureAuthenticated(config);
        engine = new ScoringEngine(provider, db, registry, llmService ?? undefined);
        breadthCalc = new BreadthCalculator(provider, db, {
          universe: 'NIFTY50',
          nifty50Constituents: nifty50,
        });
        mbiManager = new MBIDataManager(db, { sheetId: config.sheetId }, breadthCalc, chartinkClient);
        // Update the context references
        (this as PersistentCommandContext).provider = provider;
        (this as PersistentCommandContext).engine = engine;
        (this as PersistentCommandContext).mbiManager = mbiManager;
      }
    },

    isHealthy(): boolean {
      if (disposed) return false;
      try {
        db.queryOne<{ ok: number }>('SELECT 1 AS ok');
        return true;
      } catch {
        return false;
      }
    },
  };
}
