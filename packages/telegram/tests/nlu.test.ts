import { describe, it, expect } from 'bun:test';
import { NLU } from '../src/nlu.js';
import { ToolRegistry } from '../src/tool-registry.js';
import type { PersistentCommandContext } from '@stark/cli/utils/command-context.js';

function makeRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  const noopExec = async () => ({ data: null, summary: '' });

  registry.register({ name: 'score', description: 'Score a symbol', examples: ['score RELIANCE'], execute: noopExec });
  registry.register({ name: 'focus', description: 'Show focus list', examples: ['focus'], execute: noopExec });
  registry.register({ name: 'heat', description: 'Show portfolio heat', examples: ['heat'], execute: noopExec });
  registry.register({ name: 'trades', description: 'List trades', examples: ['open trades'], execute: noopExec });
  registry.register({ name: 'help', description: 'Show help', examples: ['help'], execute: noopExec });
  registry.register({ name: 'market', description: 'Market overview', examples: ['market'], execute: noopExec });
  registry.register({ name: 'morning', description: 'Morning workflow', examples: ['morning'], execute: noopExec });
  registry.register({ name: 'evening', description: 'Evening workflow', examples: ['evening'], execute: noopExec });
  registry.register({ name: 'sync', description: 'Sync data', examples: ['sync'], execute: noopExec });
  registry.register({ name: 'review', description: 'Override a factor', examples: ['review RELIANCE linearity 1'], execute: noopExec });

  return registry;
}

// Satisfy the type without actual ctx — NLU only uses it for execute which we don't call here
const NULL_CTX = null as unknown as PersistentCommandContext;

describe('NLU', () => {
  describe('exactMatch', () => {
    it('parses "score RELIANCE" correctly', async () => {
      const nlu = new NLU(makeRegistry(), null);
      const result = await nlu.parse('score RELIANCE', 'chat1', []);
      expect(result.command).toBe('score');
      expect(result.args.symbol).toBe('RELIANCE');
      expect(result.confidence).toBe(1);
    });

    it('is case insensitive for "Score reliance"', async () => {
      const nlu = new NLU(makeRegistry(), null);
      const result = await nlu.parse('Score reliance', 'chat1', []);
      expect(result.command).toBe('score');
      expect(result.args.symbol).toBe('RELIANCE');
    });

    it('parses "focus list" to focus command', async () => {
      const nlu = new NLU(makeRegistry(), null);
      const result = await nlu.parse('focus list', 'chat1', []);
      expect(result.command).toBe('focus');
      expect(result.args).toEqual({});
      expect(result.confidence).toBe(1);
    });

    it('parses "focus" to focus command', async () => {
      const nlu = new NLU(makeRegistry(), null);
      const result = await nlu.parse('focus', 'chat1', []);
      expect(result.command).toBe('focus');
    });

    it('parses "open trades" to trades with filter=open', async () => {
      const nlu = new NLU(makeRegistry(), null);
      const result = await nlu.parse('open trades', 'chat1', []);
      expect(result.command).toBe('trades');
      expect(result.args.filter).toBe('open');
    });

    it('parses "my heat" to heat command', async () => {
      const nlu = new NLU(makeRegistry(), null);
      const result = await nlu.parse('my heat', 'chat1', []);
      expect(result.command).toBe('heat');
      expect(result.confidence).toBe(1);
    });

    it('parses "help" to help command', async () => {
      const nlu = new NLU(makeRegistry(), null);
      const result = await nlu.parse('help', 'chat1', []);
      expect(result.command).toBe('help');
    });

    it('parses "?" to help command', async () => {
      const nlu = new NLU(makeRegistry(), null);
      const result = await nlu.parse('?', 'chat1', []);
      expect(result.command).toBe('help');
    });

    it('parses "morning" to morning command', async () => {
      const nlu = new NLU(makeRegistry(), null);
      const result = await nlu.parse('morning', 'chat1', []);
      expect(result.command).toBe('morning');
    });

    it('parses "sync" to sync command', async () => {
      const nlu = new NLU(makeRegistry(), null);
      const result = await nlu.parse('sync', 'chat1', []);
      expect(result.command).toBe('sync');
    });

    it('parses "closed trades" to trades with filter=closed', async () => {
      const nlu = new NLU(makeRegistry(), null);
      const result = await nlu.parse('closed trades', 'chat1', []);
      expect(result.command).toBe('trades');
      expect(result.args.filter).toBe('closed');
    });
  });

  describe('unknown input', () => {
    it('returns low confidence for unknown input with no LLM', async () => {
      const nlu = new NLU(makeRegistry(), null);
      const result = await nlu.parse('what is the weather today', 'chat1', []);
      expect(result.command).toBe('unknown');
      expect(result.confidence).toBe(0);
    });

    it('handles empty string gracefully', async () => {
      const nlu = new NLU(makeRegistry(), null);
      const result = await nlu.parse('', 'chat1', []);
      expect(result.command).toBe('unknown');
      expect(result.confidence).toBe(0);
    });
  });

  describe('multi-turn context', () => {
    it('after "score INFY", "override its linearity to 1" targets INFY', async () => {
      const nlu = new NLU(makeRegistry(), null);
      const chatId = 'chat-multi';

      // First message establishes context
      await nlu.parse('score INFY', chatId, []);

      // Second message uses pronoun reference
      const result = await nlu.parse('override its linearity to 1', chatId, []);
      expect(result.command).toBe('review');
      expect(result.args.symbol).toBe('INFY');
      expect(result.args.factor).toBe('linearity');
      expect(result.args.value).toBe('1');
    });

    it('pronoun override with decimal value', async () => {
      const nlu = new NLU(makeRegistry(), null);
      const chatId = 'chat-decimal';

      await nlu.parse('score RELIANCE', chatId, []);
      const result = await nlu.parse('override its aoi to 0.5', chatId, []);
      expect(result.command).toBe('review');
      expect(result.args.symbol).toBe('RELIANCE');
      expect(result.args.factor).toBe('aoi');
      expect(result.args.value).toBe('0.5');
    });

    it('pronoun override fails gracefully when no prior symbol', async () => {
      const nlu = new NLU(makeRegistry(), null);
      const result = await nlu.parse('override its linearity to 1', 'fresh-chat', []);
      // No prior symbol -> falls through to unknown
      expect(result.command).toBe('unknown');
    });

    it('tracks different symbols per chat', async () => {
      const nlu = new NLU(makeRegistry(), null);

      await nlu.parse('score RELIANCE', 'chat-A', []);
      await nlu.parse('score INFY', 'chat-B', []);

      const resultA = await nlu.parse('override its linearity to 1', 'chat-A', []);
      const resultB = await nlu.parse('override its linearity to 1', 'chat-B', []);

      expect(resultA.args.symbol).toBe('RELIANCE');
      expect(resultB.args.symbol).toBe('INFY');
    });
  });
});
