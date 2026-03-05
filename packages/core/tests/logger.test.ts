import { describe, it, expect, afterEach } from 'vitest';
import { Logger } from '../src/log/logger.js';
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

let tempDir: string;

afterEach(() => {
  if (tempDir && existsSync(tempDir)) {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

function readLogEntries(dir: string): Record<string, unknown>[] {
  const files = readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
  if (files.length === 0) return [];
  const content = readFileSync(join(dir, files[0]), 'utf8');
  return content
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

describe('Logger log levels', () => {
  it('does not log DEBUG when minLevel is INFO', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'stark-logger-'));
    const logger = new Logger({ logDir: tempDir, minLevel: 'INFO' });
    logger.debug('this should not appear');
    logger.info('this should appear');

    const entries = readLogEntries(tempDir);
    expect(entries).toHaveLength(1);
    expect(entries[0].level).toBe('INFO');
    expect(entries[0].message).toBe('this should appear');
  });

  it('logs WARN and ERROR when minLevel is INFO', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'stark-logger-'));
    const logger = new Logger({ logDir: tempDir, minLevel: 'INFO' });
    logger.warn('a warning');
    logger.error('an error');

    const entries = readLogEntries(tempDir);
    expect(entries).toHaveLength(2);
    expect(entries[0].level).toBe('WARN');
    expect(entries[1].level).toBe('ERROR');
  });
});

describe('Logger file output', () => {
  it('writes to file in JSONL format', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'stark-logger-'));
    const logger = new Logger({ logDir: tempDir, minLevel: 'DEBUG' });
    logger.info('hello world', { key: 'value' });

    const entries = readLogEntries(tempDir);
    expect(entries).toHaveLength(1);
    const entry = entries[0];
    expect(entry.level).toBe('INFO');
    expect(entry.message).toBe('hello world');
    expect(entry.timestamp).toBeDefined();
    expect((entry.context as Record<string, unknown>).key).toBe('value');
  });
});

describe('Logger.withCorrelation', () => {
  it('creates a new logger with correlationId', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'stark-logger-'));
    const logger = new Logger({ logDir: tempDir, minLevel: 'DEBUG' });
    const correlated = logger.withCorrelation('req-abc-123');
    correlated.info('correlated message');

    const entries = readLogEntries(tempDir);
    expect(entries).toHaveLength(1);
    expect(entries[0].correlationId).toBe('req-abc-123');
    expect(entries[0].message).toBe('correlated message');
  });
});
