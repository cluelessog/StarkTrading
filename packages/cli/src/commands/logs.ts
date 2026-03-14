import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import type { LogEntry } from '@stark/core/log/logger.js';

const LEVEL_COLORS: Record<string, string> = {
  DEBUG: '\x1b[37m',
  INFO: '\x1b[36m',
  WARN: '\x1b[33m',
  ERROR: '\x1b[31m',
};
const RESET = '\x1b[0m';

function todayString(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseLogFile(filePath: string): LogEntry[] {
  if (!existsSync(filePath)) return [];
  const raw = readFileSync(filePath, 'utf8');
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
  const time = entry.ts.slice(11, 19); // HH:MM:SS from ISO string
  const color = LEVEL_COLORS[entry.level] ?? '';
  const dataPart = entry.data ? ` ${JSON.stringify(entry.data)}` : '';
  return `${color}[${time}] ${entry.level.padEnd(5)} [${entry.component}] ${entry.event}: ${entry.msg}${dataPart}${RESET}`;
}

export async function logsCommand(args: string[]): Promise<void> {
  const logDir = join(process.env.HOME ?? '~', '.stark', 'logs');

  // Parse flags
  const errorsOnly = args.includes('--errors');
  const runIdIdx = args.indexOf('--run');
  const runId = runIdIdx !== -1 ? args[runIdIdx + 1] : undefined;
  const dateIdx = args.indexOf('--date');
  const dateArg = dateIdx !== -1 ? args[dateIdx + 1] : undefined;
  const today = args.includes('--today');

  if (args.includes('--help') || args.includes('-h')) {
    console.log('Usage: stark logs [options]');
    console.log('');
    console.log('Options:');
    console.log('  --errors          Show ERROR level entries only');
    console.log('  --run <runId>     Filter by workflow run ID');
    console.log('  --today           Show today\'s logs (default)');
    console.log('  --date YYYY-MM-DD Show logs for a specific date');
    console.log('  --help, -h        Show this help');
    return;
  }

  // Determine target date
  const targetDate = dateArg ?? todayString();
  const logPath = join(logDir, `stark-${targetDate}.jsonl`);

  let entries = parseLogFile(logPath);

  if (entries.length === 0) {
    console.log(`No logs found for ${targetDate}`);
    return;
  }

  // Apply filters
  if (errorsOnly) {
    entries = entries.filter(e => e.level === 'ERROR');
  }

  if (runId) {
    entries = entries.filter(e => e.runId === runId);
  }

  if (entries.length === 0) {
    console.log(`No matching log entries for ${targetDate}`);
    return;
  }

  // Output
  console.log(`--- Logs for ${targetDate} (${entries.length} entries) ---\n`);
  for (const entry of entries) {
    console.log(formatEntry(entry));
  }
}

// Exported for testing
export { parseLogFile, formatEntry };
