import { NLU } from '@stark/core/nlu/nlu.js';
import { ToolRegistry } from '@stark/core/nlu/tool-registry.js';
import { loadConfig } from '@stark/core/config/index.js';
import { createDatabase } from '@stark/core/db/index.js';
import { createPersistentCommandContext } from '../utils/command-context.js';
import type { PersistentCommandContext } from '../utils/command-context.js';
import { createCLIToolRegistry } from './cli-tools.js';
import * as readline from 'readline';

const DESTRUCTIVE_COMMANDS = new Set(['entry', 'exit']);

// Commands that need broker auth
const AUTH_COMMANDS = new Set(['score', 'morning', 'evening', 'sync']);

async function confirm(message: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${message} (Y/n) `, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() !== 'n');
    });
  });
}

/**
 * First parse the intent without needing auth (just NLU + registry).
 * Then only create a full context if the command actually needs it.
 */
export async function handleNaturalLanguage(text: string): Promise<void> {
  // Phase 1: Parse intent using a lightweight NLU (no context needed)
  const lightRegistry = createLightweightRegistry();
  const nlu = new NLU(lightRegistry, null);
  const intent = await nlu.parse(text, 'cli', []);

  if (intent.command === 'unknown') {
    const words = text.toLowerCase().split(/\s+/);
    const allCommands = lightRegistry.getAll().map(t => t.name);
    const suggestions = allCommands.filter(cmd =>
      words.some(w => cmd.includes(w) || w.includes(cmd))
    );
    if (suggestions.length > 0) {
      console.log(`Did you mean: ${suggestions.map(s => `stark ${s}`).join(', ')}?`);
    } else {
      console.log('Could not understand your request. Run `stark --help` for available commands.');
      console.log('Or try `stark chat` for interactive mode.');
    }
    return;
  }

  // Phase 2: Confirm destructive actions before bootstrapping context
  if (DESTRUCTIVE_COMMANDS.has(intent.command) && intent.confidence < 1) {
    const argsStr = Object.entries(intent.args).map(([k, v]) => `${k}=${v}`).join(', ');
    const confirmed = await confirm(`Understood as: ${intent.command} (${argsStr}). Proceed?`);
    if (!confirmed) {
      console.log('Cancelled.');
      return;
    }
  }

  // Phase 3: Create the appropriate context and execute
  let ctx: PersistentCommandContext | null = null;
  try {
    if (AUTH_COMMANDS.has(intent.command)) {
      // Full context with broker auth
      ctx = await createPersistentCommandContext();
    } else {
      // Lightweight: DB-only context (no broker auth needed)
      ctx = await createDBOnlyContext();
    }

    const registry = createCLIToolRegistry(ctx);
    const tool = registry.get(intent.command);
    if (!tool) {
      console.log(`Unknown command: ${intent.command}`);
      return;
    }

    const result = await tool.execute(intent.args);
    console.log(result.summary);
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes('Broker not configured') || msg.includes('not configured')) {
      console.log(`This command requires broker configuration. Run \`stark setup\` first.`);
    } else {
      console.log(`Error: ${msg}`);
    }
  } finally {
    ctx?.dispose();
  }
}

/**
 * Create a lightweight registry just for intent parsing (no execution).
 * Tools only need name/description/examples for NLU matching.
 */
function createLightweightRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  const tools = [
    { name: 'score', description: 'Score a stock symbol', examples: ['score RELIANCE', 'check RELIANCE', 'analyze TCS'] },
    { name: 'focus', description: 'Show focus list', examples: ['focus', 'what should I buy', 'what to buy'] },
    { name: 'heat', description: 'Show portfolio heat', examples: ['heat', 'risk exposure', 'what is my heat'] },
    { name: 'trades', description: 'List trades', examples: ['trades', 'open trades', 'show me my trades'] },
    { name: 'status', description: 'Show status', examples: ['status', 'show status'] },
    { name: 'market', description: 'Show market overview', examples: ['market', 'how is the market'] },
    { name: 'morning', description: 'Run morning workflow', examples: ['morning', 'run morning'] },
    { name: 'evening', description: 'Run evening workflow', examples: ['evening', 'run evening'] },
    { name: 'sync', description: 'Sync data', examples: ['sync'] },
    { name: 'review', description: 'Override factor score', examples: ['review RELIANCE linearity 1'] },
    { name: 'performance', description: 'Show performance', examples: ['performance', 'pnl', 'how am i doing'] },
    { name: 'evolve', description: 'Show factor evolution', examples: ['evolve', 'evolution'] },
    { name: 'entry', description: 'Log trade entry', examples: ['entry RELIANCE 2500 100', 'enter reliance at 2500'] },
    { name: 'exit', description: 'Log trade exit', examples: ['exit RELIANCE 2600', 'sell reliance at 2600'] },
    { name: 'mbi-analyze', description: 'MBI analysis', examples: ['mbi', 'market breadth'] },
    { name: 'logs', description: 'Show logs', examples: ['logs', 'show logs'] },
    { name: 'help', description: 'Show help', examples: ['help', 'commands'] },
  ];
  for (const t of tools) {
    registry.register({ ...t, execute: async () => ({ data: null, summary: '' }) });
  }
  return registry;
}

/**
 * Create a DB-only context that doesn't require broker auth.
 * Used for read-only commands (trades, heat, performance, etc.)
 */
async function createDBOnlyContext(): Promise<PersistentCommandContext> {
  const config = loadConfig();
  const { db, queries } = createDatabase();

  return {
    config,
    db,
    queries,
    provider: {
      name: 'none',
      authenticate: async () => {},
      isAuthenticated: () => false,
      dispose: async () => {},
      fetchOHLCV: async () => [],
      fetchQuote: async () => { throw new Error('No broker configured'); },
      fetchQuotes: async () => [],
      searchSymbol: async () => [],
      getInstrumentMaster: async () => [],
      fetchPositions: async () => [],
    } as any,
    llmService: null,
    engine: {
      scoreSymbol: async () => { throw new Error('Scoring requires broker auth. Run `stark setup` first.'); },
      scoreBatch: async () => { throw new Error('Scoring requires broker auth. Run `stark setup` first.'); },
      getRegistry: () => { throw new Error('Scoring requires broker auth.'); },
    } as any,
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as any,
    mbiManager: {} as any,
    dispose() { db.close(); },
    async refreshAuth() {},
    isHealthy() { return true; },
  } as PersistentCommandContext;
}
