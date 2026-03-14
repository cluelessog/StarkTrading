import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { homedir } from 'node:os';

export interface DatabaseAdapter {
  execute(sql: string, params?: unknown[]): void;
  /** Execute multiple SQL statements (e.g. migration scripts). */
  execMulti(sql: string): void;
  query<T>(sql: string, params?: unknown[]): T[];
  queryOne<T>(sql: string, params?: unknown[]): T | null;
  transaction<T>(fn: () => T): T;
  close(): void;
}

const DEFAULT_DB_PATH = `${homedir()}/.stark/stark.db`;

export class BunSQLiteAdapter implements DatabaseAdapter {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private db: any;

  constructor(dbPath: string = DEFAULT_DB_PATH) {
    const resolved = resolve(dbPath);
    mkdirSync(dirname(resolved), { recursive: true });

    // Dynamic import bun:sqlite at runtime — this module only runs under Bun
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Database } = require('bun:sqlite') as typeof import('bun:sqlite');
    this.db = new Database(resolved, { create: true });
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA busy_timeout = 5000;');
  }

  execute(sql: string, params: unknown[] = []): void {
    this.db.prepare(sql).run(...params);
  }

  execMulti(sql: string): void {
    this.db.exec(sql);
  }

  query<T>(sql: string, params: unknown[] = []): T[] {
    return this.db.prepare(sql).all(...params) as T[];
  }

  queryOne<T>(sql: string, params: unknown[] = []): T | null {
    return (this.db.prepare(sql).get(...params) as T | undefined) ?? null;
  }

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)() as T;
  }

  close(): void {
    this.db.close();
  }
}
