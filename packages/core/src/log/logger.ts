import { existsSync, mkdirSync, appendFileSync, readdirSync, unlinkSync } from 'fs';
import { join } from 'path';

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

export interface LogEntry {
  ts: string;
  level: LogLevel;
  runId: string;
  component: string;
  event: string;
  msg: string;
  data?: Record<string, unknown>;
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

/**
 * Generate a run ID in format `evt-YYYYMMDD-HHMMSS`.
 */
export function generateRunId(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `evt-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

/**
 * Safely stringify a value, catching circular references.
 */
function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({ _serializationError: 'Could not serialize data (circular reference or other issue)' });
  }
}

/**
 * ComponentLogger: a child logger with a fixed component prefix.
 * All log calls delegate to the parent Logger with the component pre-filled.
 */
export class ComponentLogger {
  constructor(private parentLogger: Logger, private component: string) {}

  error(event: string, msg: string, data?: Record<string, unknown>): void {
    this.parentLogger.error(this.component, event, msg, data);
  }

  warn(event: string, msg: string, data?: Record<string, unknown>): void {
    this.parentLogger.warn(this.component, event, msg, data);
  }

  info(event: string, msg: string, data?: Record<string, unknown>): void {
    this.parentLogger.info(this.component, event, msg, data);
  }

  debug(event: string, msg: string, data?: Record<string, unknown>): void {
    this.parentLogger.debug(this.component, event, msg, data);
  }
}

export class Logger {
  private logDir: string;
  private consoleLevel: LogLevel;
  private fileLevel: LogLevel;
  private runId: string = 'no-run';
  private initialized: boolean = false;

  constructor() {
    this.logDir = join(process.env.HOME ?? '~', '.stark', 'logs');
    this.consoleLevel = 'INFO';
    this.fileLevel = 'DEBUG';
  }

  /**
   * Initialize the logger for file output. Before init(), entries go to stderr only.
   * After init(), entries go to both stderr and JSONL file.
   */
  init(options?: { logDir?: string; consoleLevel?: LogLevel }): void {
    if (options?.logDir) this.logDir = options.logDir;
    if (options?.consoleLevel) this.consoleLevel = options.consoleLevel;
    if (!existsSync(this.logDir)) mkdirSync(this.logDir, { recursive: true });
    this.initialized = true;
  }

  setRunId(id: string): void {
    this.runId = id;
  }

  getRunId(): string {
    return this.runId;
  }

  /**
   * Create a child logger with a fixed component prefix.
   */
  child(component: string): ComponentLogger {
    return new ComponentLogger(this, component);
  }

  /**
   * No-op for sync writes. Keeps the interface ready for future async support.
   */
  flush(): void {
    // Sync writes — nothing to flush
  }

  debug(component: string, event: string, msg: string, data?: Record<string, unknown>): void {
    this.log('DEBUG', component, event, msg, data);
  }

  info(component: string, event: string, msg: string, data?: Record<string, unknown>): void {
    this.log('INFO', component, event, msg, data);
  }

  warn(component: string, event: string, msg: string, data?: Record<string, unknown>): void {
    this.log('WARN', component, event, msg, data);
  }

  error(component: string, event: string, msg: string, data?: Record<string, unknown>): void {
    this.log('ERROR', component, event, msg, data);
  }

  /**
   * Rotate log files older than keepDays.
   */
  rotateLogs(keepDays: number = 28): void {
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

  /** @deprecated Use rotateLogs() instead */
  rotateOldLogs(keepDays: number = 28): void {
    this.rotateLogs(keepDays);
  }

  private log(
    level: LogLevel,
    component: string,
    event: string,
    msg: string,
    data?: Record<string, unknown>,
  ): void {
    const ts = new Date().toISOString();
    const entry: LogEntry = {
      ts,
      level,
      runId: this.runId,
      component,
      event,
      msg,
      ...(data !== undefined && { data }),
    };

    // Console output to stderr (colored)
    if (LEVEL_ORDER[level] >= LEVEL_ORDER[this.consoleLevel]) {
      const color = LEVEL_COLORS[level];
      const dataPart = data ? ` ${safeStringify(data)}` : '';
      process.stderr.write(`${color}[${ts}] ${level} [${component}] ${event}: ${msg}${dataPart}${RESET}\n`);
    }

    // File output (JSONL) — only after init()
    if (this.initialized && LEVEL_ORDER[level] >= LEVEL_ORDER[this.fileLevel]) {
      const logPath = this.getLogPath();
      let jsonLine: string;
      try {
        jsonLine = JSON.stringify(entry);
      } catch {
        // Data likely has circular reference — serialize entry without data, add error marker
        const safeEntry = { ...entry, data: { _serializationError: 'Could not serialize data (circular reference or other issue)' } };
        jsonLine = JSON.stringify(safeEntry);
      }
      appendFileSync(logPath, jsonLine + '\n', 'utf8');
    }
  }

  private getLogPath(): string {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return join(this.logDir, `stark-${y}-${m}-${d}.jsonl`);
  }
}

// Singleton default logger
export const logger: Logger = new Logger();
