import { describe, it, expect, afterEach } from 'vitest';
import { ScoringLog } from '../src/log/scoring-log.js';
import type { ScoringLogEntry } from '../src/log/scoring-log.js';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

let tempDir: string;

function makeEntry(overrides: Partial<ScoringLogEntry> = {}): ScoringLogEntry {
  return {
    timestamp: '2026-03-05T10:00:00.000Z',
    sessionId: 'sess-001',
    symbol: 'RELIANCE',
    factor: 'ep_catalyst',
    inputSummary: { price: 2500 },
    result: 1.5,
    reasoning: 'Strong earnings',
    dataSource: 'screener',
    ...overrides,
  };
}

afterEach(() => {
  if (tempDir && existsSync(tempDir)) {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

describe('ScoringLog.append', () => {
  it('writes a JSONL entry to the log file', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'stark-test-'));
    const log = new ScoringLog(tempDir);
    const entry = makeEntry();
    log.append(entry);

    const entries = log.read();
    expect(entries).toHaveLength(1);
    expect(entries[0].symbol).toBe('RELIANCE');
    expect(entries[0].factor).toBe('ep_catalyst');
  });
});

describe('ScoringLog.read', () => {
  it('parses JSONL entries back correctly', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'stark-test-'));
    const log = new ScoringLog(tempDir);
    const entry1 = makeEntry({ symbol: 'INFY', result: 2.0 });
    const entry2 = makeEntry({ symbol: 'TCS', result: 1.0 });
    log.append(entry1);
    log.append(entry2);

    const entries = log.read();
    expect(entries).toHaveLength(2);
    expect(entries[0].symbol).toBe('INFY');
    expect(entries[0].result).toBe(2.0);
    expect(entries[1].symbol).toBe('TCS');
    expect(entries[1].result).toBe(1.0);
  });

  it('skips malformed lines without throwing', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'stark-test-'));
    const log = new ScoringLog(tempDir);
    const entry = makeEntry();
    log.append(entry);

    // Inject a malformed line directly into the file
    const logPath = log.getLogPath();
    writeFileSync(logPath, JSON.stringify(entry) + '\n' + 'NOT_VALID_JSON\n', 'utf8');

    let result: ScoringLogEntry[];
    expect(() => {
      result = log.read();
    }).not.toThrow();
    expect(result!).toHaveLength(1);
    expect(result![0].symbol).toBe('RELIANCE');
  });
});
