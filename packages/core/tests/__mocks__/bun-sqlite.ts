// Shim for bun:sqlite using better-sqlite3, for use in Node/vitest environments.
// The API surface matches what BunSQLiteAdapter and db.test.ts use.
import BetterSqlite3 from 'better-sqlite3';

export class Database {
  private db: BetterSqlite3.Database;

  constructor(path: string, _options?: { create?: boolean }) {
    this.db = new BetterSqlite3(path);
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  prepare(sql: string): Statement {
    return new Statement(this.db.prepare(sql));
  }

  transaction(fn: () => unknown): () => unknown {
    const txFn = this.db.transaction(fn);
    return txFn;
  }

  close(): void {
    this.db.close();
  }
}

class Statement {
  constructor(private stmt: BetterSqlite3.Statement) {}

  run(...params: unknown[]): void {
    this.stmt.run(...params);
  }

  get(...params: unknown[]): unknown {
    return this.stmt.get(...params);
  }

  all(...params: unknown[]): unknown[] {
    return this.stmt.all(...params);
  }
}
