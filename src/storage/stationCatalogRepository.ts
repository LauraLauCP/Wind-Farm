import Database from 'better-sqlite3';
import { DateTime } from 'luxon';
import { runMigrations } from './migrations.js';

/** How a station's readings are sourced (Q9: per-station strategy). */
export type SourceStrategy = 'antartida' | 'composite';

/** One station of the catalog table (Q14 schema: `stations`). */
export interface StationRecord {
  /** AEMET "indicativo" (e.g. "8178D") — the {identificacion} of the generalized route. */
  readonly id: string;
  readonly name: string;
  readonly province: string | null;
  readonly latitude: number | null;
  readonly longitude: number | null;
  readonly sourceStrategy: SourceStrategy;
  /** IANA zone used to draw aggregation boundaries (station-dependent). */
  readonly aggregationTimezone: string;
  readonly syncedAt: DateTime | null;
}

function toStorageInstant(instant: DateTime): string {
  return instant.toUTC().toFormat("yyyy-MM-dd'T'HH:mm:ss'Z'");
}

/**
 * Persistence for the station catalog, synced from the AEMET inventory
 * (Q3: DB-synced catalog with an embedded fallback seed).
 */
export class StationCatalogRepository {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('busy_timeout = 5000');
    runMigrations(this.db);
  }

  /** Upserts catalog rows idempotently in one transaction. */
  upsertCatalog(stations: readonly StationRecord[]): void {
    const statement = this.db.prepare(
      `INSERT INTO stations (id, name, province, latitude, longitude, source_strategy, aggregation_timezone, synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET
         name = excluded.name,
         province = excluded.province,
         latitude = excluded.latitude,
         longitude = excluded.longitude,
         source_strategy = excluded.source_strategy,
         aggregation_timezone = excluded.aggregation_timezone,
         synced_at = excluded.synced_at`,
    );
    const transaction = this.db.transaction((rows: readonly StationRecord[]) => {
      for (const station of rows) {
        statement.run(
          station.id,
          station.name,
          station.province,
          station.latitude,
          station.longitude,
          station.sourceStrategy,
          station.aggregationTimezone,
          station.syncedAt ? toStorageInstant(station.syncedAt) : null,
        );
      }
    });
    transaction(stations);
  }

  /** Finds a station by its AEMET indicativo, or null when unknown. */
  findStation(id: string): StationRecord | null {
    const row = this.db
      .prepare<[string], {
        id: string;
        name: string;
        province: string | null;
        latitude: number | null;
        longitude: number | null;
        source_strategy: SourceStrategy;
        aggregation_timezone: string;
        synced_at: string | null;
      }>('SELECT * FROM stations WHERE id = ?')
      .get(id.trim().toUpperCase());
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      name: row.name,
      province: row.province,
      latitude: row.latitude,
      longitude: row.longitude,
      sourceStrategy: row.source_strategy,
      aggregationTimezone: row.aggregation_timezone,
      syncedAt: row.synced_at ? DateTime.fromISO(row.synced_at, { zone: 'utc' }) : null,
    };
  }

  close(): void {
    this.db.close();
  }
}
