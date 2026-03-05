import { existsSync, mkdirSync, appendFileSync, readFileSync, readdirSync, unlinkSync } from 'fs';
import { join } from 'path';

export interface ScoringLogEntry {
  timestamp: string;
  sessionId: string;
  symbol: string;
  factor: string;
  inputSummary: Record<string, unknown>;
  result: number;
  reasoning: string;
  dataSource: string;
}

export class ScoringLog {
  private logDir: string;

  constructor(logDir: string = join(process.env.HOME ?? '~', '.stark', 'logs')) {
    this.logDir = logDir;
    if (!existsSync(this.logDir)) mkdirSync(this.logDir, { recursive: true });
  }

  append(entry: ScoringLogEntry): void {
    const path = this.getLogPath();
    appendFileSync(path, JSON.stringify(entry) + '\n', 'utf8');
  }

  read(date?: string): ScoringLogEntry[] {
    const path = this.getLogPath(date);
    if (!existsSync(path)) return [];
    const raw = readFileSync(path, 'utf8');
    const entries: ScoringLogEntry[] = [];
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        entries.push(JSON.parse(trimmed) as ScoringLogEntry);
      } catch {
        // skip malformed lines
      }
    }
    return entries;
  }

  getLogPath(date?: string): string {
    const d = date ?? this.todayString();
    return join(this.logDir, `scoring-${d}.jsonl`);
  }

  rotateOldLogs(keepDays: number = 28): void {
    if (!existsSync(this.logDir)) return;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - keepDays);
    const files = readdirSync(this.logDir);
    for (const file of files) {
      const match = file.match(/^scoring-(\d{4}-\d{2}-\d{2})\.jsonl$/);
      if (!match) continue;
      const fileDate = new Date(match[1] + 'T00:00:00');
      if (fileDate < cutoff) {
        unlinkSync(join(this.logDir, file));
      }
    }
  }

  private todayString(): string {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
}
