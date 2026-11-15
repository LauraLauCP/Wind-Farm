import type Database from 'better-sqlite3';

/**
 * Ordered, versioned schema migrations (Q15: tiny hand-rolled runner, no
 * dependencies). Each entry's `sql` is applied inside a transaction the first
 * time the application boots against a database; `schema_version` records
 * what has been applied so later versions can evolve the schema.
 */
interface Migration {
  readonly version: number;
  readonly sql: string;
}

const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS stations (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        province TEXT,
        latitude REAL,
        longitude REAL,
        source_strategy TEXT NOT NULL,
        aggregation_timezone TEXT NOT NULL,
        synced_at TEXT
      );

      CREATE TABLE IF NOT EXISTS readings (
        station_id TEXT NOT NULL,
        ts_utc TEXT NOT NULL,
        product TEXT NOT NULL,
        temperature REAL,
        pressure REAL,
        speed REAL,
        PRIMARY KEY (station_id, ts_utc, product)
      );

      CREATE INDEX IF NOT EXISTS idx_readings_station_ts ON readings (station_id, ts_utc);

      CREATE TABLE IF NOT EXISTS range_sync (
        station_id TEXT NOT NULL,
        product TEXT NOT NULL,
        chunk_start TEXT NOT NULL,
        chunk_end TEXT NOT NULL,
        synced_at TEXT NOT NULL,
        PRIMARY KEY (station_id, product, chunk_start, chunk_end)
      );
    `,
  },
];

/** Applies all pending migrations inside a single transaction. */
export function runMigrations(db: Database.Database): void {
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)');
  const applied = db
    .prepare<[], { version: number }>('SELECT version FROM schema_version')
    .all()
    .map((row) => row.version);

  for (const migration of MIGRATIONS) {
    if (applied.includes(migration.version)) {
      continue;
    }
    const transaction = db.transaction(() => {
      db.exec(migration.sql);
      db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(migration.version);
    });
    transaction();
  }
}
