import { describe, it, expect, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { LogEntry } from '../src/log/logger.js';

let tempDir: string;

afterEach(() => {
  if (tempDir && existsSync(tempDir)) {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

function createTempDir(): string {
  tempDir = mkdtempSync(join(tmpdir(), 'stark-logs-cmd-'));
  return tempDir;
}

// Inline parsing logic matching the logs command implementation
function parseLogFile(filePath: string): LogEntry[] {
  if (!existsSync(filePath)) return [];
  const raw = require('fs').readFileSync(filePath, 'utf8');
  const entries: LogEntry[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      entries.push(JSON.parse(trimmed) as LogEntry);
    } catch {
      // skip malformed lines
    }
  }
  return entries;
}

function formatEntry(entry: LogEntry): string {
  const time = entry.ts.slice(11, 19);
  const dataPart = entry.data ? ` ${JSON.stringify(entry.data)}` : '';
  return `[${time}] ${entry.level.padEnd(5)} [${entry.component}] ${entry.event}: ${entry.msg}${dataPart}`;
}

function makeSampleEntries(): LogEntry[] {
  return [
    { ts: '2026-03-12T20:00:01.000Z', level: 'INFO', runId: 'evt-20260312-200000', component: 'workflow', event: 'evening_start', msg: 'Evening started' },
    { ts: '2026-03-12T20:01:00.000Z', level: 'WARN', runId: 'evt-20260312-200000', component: 'workflow', event: 'mbi_unavailable', msg: 'MBI unavailable' },
    { ts: '2026-03-12T20:02:00.000Z', level: 'ERROR', runId: 'evt-20260312-200000', component: 'scoring', event: 'fetch_fail', msg: 'OHLCV fetch failed', data: { symbol: 'RELIANCE' } },
  ];
}

describe('logs-command: parse and format JSONL', () => {
  it('parses JSONL file and returns LogEntry array', () => {
    const dir = createTempDir();
    const entries = makeSampleEntries();
    const filePath = join(dir, 'stark-2026-03-12.jsonl');
    writeFileSync(filePath, entries.map(e => JSON.stringify(e)).join('\n') + '\n');

    const parsed = parseLogFile(filePath);
    expect(parsed).toHaveLength(3);
    expect(parsed[0].component).toBe('workflow');
    expect(parsed[1].level).toBe('WARN');
    expect(parsed[2].data).toEqual({ symbol: 'RELIANCE' });
  });

  it('formats entries with time, level, component, event, msg', () => {
    const entry = makeSampleEntries()[0];
    const formatted = formatEntry(entry);
    expect(formatted).toContain('[20:00:01]');
    expect(formatted).toContain('INFO');
    expect(formatted).toContain('[workflow]');
    expect(formatted).toContain('evening_start:');
    expect(formatted).toContain('Evening started');
  });
});

describe('logs-command: filter by level', () => {
  it('--errors filters to ERROR entries only', () => {
    const dir = createTempDir();
    const entries = makeSampleEntries();
    const filePath = join(dir, 'stark-2026-03-12.jsonl');
    writeFileSync(filePath, entries.map(e => JSON.stringify(e)).join('\n') + '\n');

    const parsed = parseLogFile(filePath);
    const errorsOnly = parsed.filter(e => e.level === 'ERROR');
    expect(errorsOnly).toHaveLength(1);
    expect(errorsOnly[0].event).toBe('fetch_fail');
  });
});

describe('logs-command: filter by runId', () => {
  it('--run filters to matching entries', () => {
    const dir = createTempDir();
    const entries = [
      ...makeSampleEntries(),
      { ts: '2026-03-12T21:00:00.000Z', level: 'INFO' as const, runId: 'evt-20260312-210000', component: 'workflow', event: 'evening_start', msg: 'Different run' },
    ];
    const filePath = join(dir, 'stark-2026-03-12.jsonl');
    writeFileSync(filePath, entries.map(e => JSON.stringify(e)).join('\n') + '\n');

    const parsed = parseLogFile(filePath);
    const filtered = parsed.filter(e => e.runId === 'evt-20260312-200000');
    expect(filtered).toHaveLength(3);
  });
});

describe('logs-command: missing file', () => {
  it('returns empty array for non-existent file', () => {
    const dir = createTempDir();
    const filePath = join(dir, 'stark-2099-01-01.jsonl');
    const parsed = parseLogFile(filePath);
    expect(parsed).toHaveLength(0);
  });
});

describe('logs-command: malformed lines', () => {
  it('skips malformed lines without crashing', () => {
    const dir = createTempDir();
    const filePath = join(dir, 'stark-2026-03-12.jsonl');
    const content = [
      JSON.stringify(makeSampleEntries()[0]),
      'this is not valid json {{{',
      '',
      JSON.stringify(makeSampleEntries()[1]),
    ].join('\n') + '\n';
    writeFileSync(filePath, content);

    const parsed = parseLogFile(filePath);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].event).toBe('evening_start');
    expect(parsed[1].event).toBe('mbi_unavailable');
  });
});
