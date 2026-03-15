import { describe, it, expect } from 'bun:test';
import { NLU } from '../src/nlu.js';
import { ToolRegistry } from '../src/tool-registry.js';

function makeRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  const noopExec = async () => ({ data: null, summary: '' });
  registry.register({ name: 'entry', description: 'Log entry', examples: ['entry RELIANCE 2500 100'], execute: noopExec });
  registry.register({ name: 'exit', description: 'Log exit', examples: ['exit RELIANCE 2600'], execute: noopExec });
  registry.register({ name: 'score', description: 'Score', examples: ['score RELIANCE'], execute: noopExec });
  registry.register({ name: 'review', description: 'Review', examples: ['review'], execute: noopExec });
  return registry;
}

describe('NLU entry/exit patterns', () => {
  it('parses "entry RELIANCE 2500 100 2450" with stop', async () => {
    const nlu = new NLU(makeRegistry(), null);
    const r = await nlu.parse('entry RELIANCE 2500 100 2450', 'c1', []);
    expect(r.command).toBe('entry');
    expect(r.args.symbol).toBe('RELIANCE');
    expect(r.args.price).toBe('2500');
    expect(r.args.shares).toBe('100');
    expect(r.args.stop).toBe('2450');
    expect(r.confidence).toBe(1);
  });

  it('parses "entry INFY 1500 50" without stop', async () => {
    const nlu = new NLU(makeRegistry(), null);
    const r = await nlu.parse('entry INFY 1500 50', 'c1', []);
    expect(r.command).toBe('entry');
    expect(r.args.symbol).toBe('INFY');
    expect(r.args.shares).toBe('50');
    expect(r.args.stop).toBeUndefined();
  });

  it('parses "exit RELIANCE 2600" with default reason', async () => {
    const nlu = new NLU(makeRegistry(), null);
    const r = await nlu.parse('exit RELIANCE 2600', 'c1', []);
    expect(r.command).toBe('exit');
    expect(r.args.symbol).toBe('RELIANCE');
    expect(r.args.price).toBe('2600');
    expect(r.args.reason).toBeUndefined();
  });

  it('parses "exit RELIANCE 2600 target" with reason', async () => {
    const nlu = new NLU(makeRegistry(), null);
    const r = await nlu.parse('exit RELIANCE 2600 target', 'c1', []);
    expect(r.command).toBe('exit');
    expect(r.args.reason).toBe('TARGET');
  });

  it('is case insensitive: "Entry reliance 2500 100"', async () => {
    const nlu = new NLU(makeRegistry(), null);
    const r = await nlu.parse('Entry reliance 2500 100', 'c1', []);
    expect(r.command).toBe('entry');
    expect(r.args.symbol).toBe('RELIANCE');
  });

  it('entry sets lastSymbolByChat for pronoun resolution', async () => {
    const nlu = new NLU(makeRegistry(), null);
    await nlu.parse('entry RELIANCE 2500 100 2450', 'c1', []);
    const r = await nlu.parse('override its linearity to 1', 'c1', []);
    expect(r.command).toBe('review');
    expect(r.args.symbol).toBe('RELIANCE');
  });
});
