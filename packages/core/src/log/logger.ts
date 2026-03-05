import { existsSync, mkdirSync, appendFileSync, readdirSync, unlinkSync } from 'fs';
import { join } from 'path';

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  correlationId?: string;
  context?: Record<string, unknown>;
}

const LEVEL_ORDER: Record<LogLevel, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

const LEVEL_COLORS: Record<LogLevel, string> = {
  DEBUG: '\x1b[37m',   // white
  INFO: '\x1b[36m',    // cyan
  WARN: '\x1b[33m',    // yellow
  ERROR: '\x1b[31m',   // red
};
const RESET = '\x1b[0m';

export class Logger {
  private logDir: string;
  private minLevel: LogLevel;
  private correlationId?: string;

  constructor(options?: { logDir?: string; minLevel?: LogLevel; correlationId?: string }) {
    this.logDir = options?.logDir ?? join(process.env.HOME ?? '~', '.stark', 'logs');
    this.minLevel = options?.minLevel ?? 'INFO';
    this.correlationId = options?.correlationId;
    if (!existsSync(this.logDir)) mkdirSync(this.logDir, { recursive: true });
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.log('DEBUG', message, context);
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.log('INFO', message, context);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.log('WARN', message, context);
  }

  error(message: string, context?: Record<string, unknown>): void {
    this.log('ERROR', message, context);
  }

  withCorrelation(id: string): Logger {
    return new Logger({
      logDir: this.logDir,
      minLevel: this.minLevel,
      correlationId: id,
    });
  }

  private log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    if (!this.shouldLog(level)) return;

    const timestamp = new Date().toISOString();
    const entry: LogEntry = {
      timestamp,
      level,
      message,
      ...(this.correlationId !== undefined && { correlationId: this.correlationId }),
      ...(context !== undefined && { context }),
    };

    // Console output (colored)
    const color = LEVEL_COLORS[level];
    const corrPart = this.correlationId ? ` [${this.correlationId}]` : '';
    const contextPart = context ? ` ${JSON.stringify(context)}` : '';
    console.log(`${color}[${timestamp}] ${level}${corrPart}: ${message}${contextPart}${RESET}`);

    // File output (JSONL)
    const logPath = this.getLogPath();
    appendFileSync(logPath, JSON.stringify(entry) + '\n', 'utf8');
  }

  private shouldLog(level: LogLevel): boolean {
    return LEVEL_ORDER[level] >= LEVEL_ORDER[this.minLevel];
  }

  private getLogPath(): string {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return join(this.logDir, `stark-${y}-${m}-${d}.jsonl`);
  }

  rotateOldLogs(keepDays: number = 28): void {
    if (!existsSync(this.logDir)) return;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - keepDays);
    const files = readdirSync(this.logDir);
    for (const file of files) {
      const match = file.match(/^stark-(\d{4}-\d{2}-\d{2})\.jsonl$/);
      if (!match) continue;
      const fileDate = new Date(match[1] + 'T00:00:00');
      if (fileDate < cutoff) {
        unlinkSync(join(this.logDir, file));
      }
    }
  }
}

// Singleton default logger
export const logger: Logger = new Logger();
