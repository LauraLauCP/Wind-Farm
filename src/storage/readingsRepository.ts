import Database from 'better-sqlite3';
import { DateTime } from 'luxon';
import { runMigrations } from './migrations.js';

/** Which AEMET product a stored reading came from (drives freshness policy). */
export type ProductName = 'antartida' | 'observation' | 'climatology';

/** One raw reading at its product's native granularity, as stored in SQLite. */
export interface StoredReading {
  readonly instant: DateTime;
  readonly product: ProductName;
  readonly temperature: number | null;
  readonly pressure: number | null;
  readonly speed: number | null;
}

/** Uniform UTC storage format (fixed width, so text comparison is chronological). */
function toStorageInstant(instant: DateTime): string {
  return instant.toUTC().toFormat("yyyy-MM-dd'T'HH:mm:ss'Z'");
}

function fromStorageInstant(value: string): DateTime {
  return DateTime.fromISO(value, { zone: 'utc' });
}

/**
 * Persistence for cached AEMET readings (Q14 schema: `readings` table keyed by
 * station + timestamp + product). Upserts are idempotent so re-fetching a
 * stale chunk simply overwrites, never duplicates.
 */
export class ReadingsRepository {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    // WAL gives concurrent readers with a single writer: the deployment model
    // (Q12) is one process, but WAL is the safe default regardless.
    this.db.pragma('journal_mode = WAL');
    runMigrations(this.db);
    this.db.pragma('busy_timeout = 5000');
  }

  /** Stores readings for one station, replacing any existing rows at the same instant+product. */
  upsertReadings(stationId: string, readings: readonly StoredReading[]): void {
    const statement = this.db.prepare(
      `INSERT INTO readings (station_id, ts_utc, product, temperature, pressure, speed)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (station_id, ts_utc, product) DO UPDATE SET
         temperature = excluded.temperature,
         pressure = excluded.pressure,
         speed = excluded.speed`,
    );
    const transaction = this.db.transaction((rows: readonly StoredReading[]) => {
      for (const reading of rows) {
        statement.run(
          stationId,
          toStorageInstant(reading.instant),
          reading.product,
          reading.temperature,
          reading.pressure,
          reading.speed,
        );
      }
    });
    transaction(readings);
  }

  /** Returns the stored readings of a station within [startUtc, endUtc] (inclusive), chronological. */
  readRange(stationId: string, startUtc: DateTime, endUtc: DateTime): StoredReading[] {
    const rows = this.db
      .prepare<[string, string, string], { ts_utc: string; product: ProductName; temperature: number | null; pressure: number | null; speed: number | null }>(
        `SELECT ts_utc, product, temperature, pressure, speed
         FROM readings
         WHERE station_id = ? AND ts_utc >= ? AND ts_utc <= ?
         ORDER BY ts_utc`,
      )
      .all(stationId, toStorageInstant(startUtc), toStorageInstant(endUtc));
    return rows.map((row) => ({
      instant: fromStorageInstant(row.ts_utc),
      product: row.product,
      temperature: row.temperature,
      pressure: row.pressure,
      speed: row.speed,
    }));
  }

  close(): void {
    this.db.close();
  }
}
