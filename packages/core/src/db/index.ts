export type { DatabaseAdapter } from './adapter';
export { BunSQLiteAdapter } from './adapter';
export { SCHEMA_VERSION, MIGRATIONS } from './schema';
export type { Migration } from './schema';
export { getCurrentVersion, runMigrations } from './migrations';
export { Queries } from './queries';
export type {
  Position,
  InsertWatchlistStockData,
  UpsertOHLCVData,
  InsertStockScoreData,
  InsertTradeData,
  CloseTradeData,
  UpsertMBIData,
} from './queries';

import { BunSQLiteAdapter } from './adapter';
import { runMigrations } from './migrations';
import { Queries } from './queries';
import type { DatabaseAdapter } from './adapter';

export function createDatabase(dbPath?: string): {
  db: DatabaseAdapter;
  queries: Queries;
} {
  const db = new BunSQLiteAdapter(dbPath);
  runMigrations(db);
  const queries = new Queries(db);
  return { db, queries };
}
