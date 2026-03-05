import type { DatabaseAdapter } from './adapter';
import { MIGRATIONS } from './schema';

export function getCurrentVersion(db: DatabaseAdapter): number {
  // schema_version table may not exist yet on a fresh DB
  try {
    const row = db.queryOne<{ version: number }>(
      'SELECT MAX(version) AS version FROM schema_version'
    );
    return row?.version ?? 0;
  } catch {
    return 0;
  }
}

export function runMigrations(db: DatabaseAdapter): void {
  const current = getCurrentVersion(db);

  const pending = MIGRATIONS.filter((m) => m.version > current).sort(
    (a, b) => a.version - b.version
  );

  for (const migration of pending) {
    db.transaction(() => {
      // Execute the migration SQL — may contain multiple statements
      db.execMulti(migration.sql);
      db.execute(
        'INSERT OR REPLACE INTO schema_version (version) VALUES (?)',
        [migration.version]
      );
    });
  }
}
