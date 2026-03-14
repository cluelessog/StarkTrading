import { describe, it, expect, afterEach } from 'bun:test';
import { Logger, generateRunId } from '../src/log/logger.js';
import type { LogEntry } from '../src/log/logger.js';
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

let tempDir: string;

afterEach(() => {
  if (tempDir && existsSync(tempDir)) {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

function createTempDir(): string {
  tempDir = mkdtempSync(join(tmpdir(), 'stark-logger-'));
  return tempDir;
}

function readLogEntries(dir: string): LogEntry[] {
  const files = readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
  if (files.length === 0) return [];
  const content = readFileSync(join(dir, files[0]), 'utf8');
  return content
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as LogEntry);
}

describe('LogEntry format', () => {
  it('writes entries with ts, level, runId, component, event, msg fields', () => {
    const dir = createTempDir();
    const log = new Logger();
    log.init({ logDir: dir, consoleLevel: 'ERROR' });
    log.info('api.angel', 'auth_check', 'Checking session');

    const entries = readLogEntries(dir);
    expect(entries).toHaveLength(1);
    const entry = entries[0];
    expect(entry.ts).toBeDefined();
    expect(entry.level).toBe('INFO');
    expect(entry.runId).toBe('no-run');
    expect(entry.component).toBe('api.angel');
    expect(entry.event).toBe('auth_check');
    expect(entry.msg).toBe('Checking session');
  });

  it('includes data field when provided', () => {
    const dir = createTempDir();
    const log = new Logger();
    log.init({ logDir: dir, consoleLevel: 'ERROR' });
    log.info('workflow', 'state_change', 'Phase transition', { from: 'scoring', to: 'focus' });

    const entries = readLogEntries(dir);
    expect(entries).toHaveLength(1);
    expect(entries[0].data).toEqual({ from: 'scoring', to: 'focus' });
  });
});

describe('runId propagation', () => {
  it('setRunId propagates to all subsequent entries', () => {
    const dir = createTempDir();
    const log = new Logger();
    log.init({ logDir: dir, consoleLevel: 'ERROR' });
    log.setRunId('evt-20260312-200000');
    log.info('workflow', 'test', 'After setRunId');

    const entries = readLogEntries(dir);
    expect(entries).toHaveLength(1);
    expect(entries[0].runId).toBe('evt-20260312-200000');
  });

  it('default runId is no-run before setRunId', () => {
    const dir = createTempDir();
    const log = new Logger();
    log.init({ logDir: dir, consoleLevel: 'ERROR' });
    log.info('test', 'default_run', 'Before setRunId');

    const entries = readLogEntries(dir);
    expect(entries[0].runId).toBe('no-run');
  });
});

describe('ComponentLogger', () => {
  it('child() returns logger where all entries have fixed component', () => {
    const dir = createTempDir();
    const log = new Logger();
    log.init({ logDir: dir, consoleLevel: 'ERROR' });
    const child = log.child('api.angel');
    child.info('auth_check', 'Checking session');
    child.warn('auth_fail', 'Session expired');

    const entries = readLogEntries(dir);
    expect(entries).toHaveLength(2);
    expect(entries[0].component).toBe('api.angel');
    expect(entries[1].component).toBe('api.angel');
    expect(entries[0].event).toBe('auth_check');
    expect(entries[1].event).toBe('auth_fail');
  });

  it('multiple children share the same runId', () => {
    const dir = createTempDir();
    const log = new Logger();
    log.init({ logDir: dir, consoleLevel: 'ERROR' });
    log.setRunId('evt-test-shared');
    const child1 = log.child('scoring');
    const child2 = log.child('workflow');
    child1.info('start', 'Scoring started');
    child2.info('start', 'Workflow started');

    const entries = readLogEntries(dir);
    expect(entries).toHaveLength(2);
    expect(entries[0].runId).toBe('evt-test-shared');
    expect(entries[1].runId).toBe('evt-test-shared');
  });
});

describe('Level filtering', () => {
  it('with consoleLevel=WARN, DEBUG/INFO still reach file', () => {
    const dir = createTempDir();
    const log = new Logger();
    log.init({ logDir: dir, consoleLevel: 'WARN' });
    log.debug('test', 'dbg', 'Debug message');
    log.info('test', 'inf', 'Info message');
    log.warn('test', 'wrn', 'Warn message');
    log.error('test', 'err', 'Error message');

    const entries = readLogEntries(dir);
    // File captures DEBUG+ (all 4)
    expect(entries).toHaveLength(4);
    expect(entries.map(e => e.level)).toEqual(['DEBUG', 'INFO', 'WARN', 'ERROR']);
  });
});

describe('File output', () => {
  it('writes 10 entries, all parse as valid JSON with correct fields', () => {
    const dir = createTempDir();
    const log = new Logger();
    log.init({ logDir: dir, consoleLevel: 'ERROR' });
    for (let i = 0; i < 10; i++) {
      log.info('test', 'iteration', `Entry ${i}`, { index: i });
    }

    const entries = readLogEntries(dir);
    expect(entries).toHaveLength(10);
    for (const entry of entries) {
      expect(entry.ts).toBeDefined();
      expect(entry.level).toBe('INFO');
      expect(entry.component).toBe('test');
      expect(entry.event).toBe('iteration');
    }
  });
});

describe('Pre-init behavior', () => {
  it('before init(), no file is created', () => {
    const dir = createTempDir();
    const log = new Logger();
    // Do NOT call init — write directly
    log.info('test', 'pre_init', 'This should not create a file');

    const files = readdirSync(dir).filter(f => f.endsWith('.jsonl'));
    expect(files).toHaveLength(0);
  });

  it('after init(), entries appear in file', () => {
    const dir = createTempDir();
    const log = new Logger();
    log.init({ logDir: dir, consoleLevel: 'ERROR' });
    log.info('test', 'post_init', 'This should appear in file');

    const entries = readLogEntries(dir);
    expect(entries).toHaveLength(1);
    expect(entries[0].event).toBe('post_init');
  });
});

describe('JSON.stringify safety', () => {
  it('entry with circular reference data does not throw', () => {
    const dir = createTempDir();
    const log = new Logger();
    log.init({ logDir: dir, consoleLevel: 'ERROR' });

    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;

    // Should not throw
    log.info('test', 'circular', 'Circular data', circular);

    const entries = readLogEntries(dir);
    expect(entries).toHaveLength(1);
    // The entry should have a serialization error marker
    expect(entries[0].msg).toBe('Circular data');
  });
});

describe('rotateLogs', () => {
  it('deletes files older than keepDays', () => {
    const dir = createTempDir();
    const log = new Logger();
    log.init({ logDir: dir });

    // Create fake old log files
    writeFileSync(join(dir, 'stark-2020-01-01.jsonl'), '{"test":true}\n');
    writeFileSync(join(dir, 'stark-2020-06-15.jsonl'), '{"test":true}\n');
    // Create a recent one (today)
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    writeFileSync(join(dir, `stark-${y}-${m}-${d}.jsonl`), '{"test":true}\n');

    log.rotateLogs(7);

    const remaining = readdirSync(dir).filter(f => f.endsWith('.jsonl'));
    // Only today's file should remain
    expect(remaining).toHaveLength(1);
    expect(remaining[0]).toBe(`stark-${y}-${m}-${d}.jsonl`);
  });
});

describe('generateRunId', () => {
  it('matches evt-YYYYMMDD-HHMMSS pattern', () => {
    const id = generateRunId();
    expect(id).toMatch(/^evt-\d{8}-\d{6}$/);
  });
});
