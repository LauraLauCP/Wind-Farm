import { DateTime } from 'luxon';
import { parseDmsToDecimal } from '../domain/coordinates.js';
import type { InventoryStation } from '../client/inventoryClient.js';
import { STATIONS } from '../domain/stations.js';
import type { StationCatalogRepository, StationRecord } from '../storage/stationCatalogRepository.js';

/** Source of the station inventory (AEMET client in production, fake in tests). */
export interface InventoryClient {
  fetchAllStations(): Promise<readonly InventoryStation[]>;
}

/** Provinces that aggregate in the Canary Islands' time zone. */
const CANARY_PROVINCES = new Set(['LAS PALMAS', 'SANTA CRUZ DE TENERIFE']);

function stationTimezone(province: string | null): string {
  return province !== null && CANARY_PROVINCES.has(province.toUpperCase()) ? 'Atlantic/Canary' : 'Europe/Madrid';
}

function inventoryRowToStation(row: InventoryStation, syncedAt: DateTime): StationRecord | null {
  if (typeof row.indicativo !== 'string' || row.indicativo.trim() === '') {
    return null;
  }
  const name = typeof row.nombre === 'string' && row.nombre.trim() !== '' ? row.nombre.trim() : row.indicativo.trim();
  const province = typeof row.provincia === 'string' && row.provincia.trim() !== '' ? row.provincia.trim() : null;
  return {
    id: row.indicativo.trim().toUpperCase(),
    name,
    province,
    latitude: typeof row.latitud === 'string' ? parseDmsToDecimal(row.latitud) : null,
    longitude: typeof row.longitud === 'string' ? parseDmsToDecimal(row.longitud) : null,
    sourceStrategy: 'composite',
    aggregationTimezone: stationTimezone(province),
    syncedAt,
  };
}

/**
 * The two Antarctic stations are NOT part of the AEMET inventory (verified
 * against the live endpoint), so they are always seeded here — this is what
 * keeps the catalog usable when the inventory endpoint is unreachable (Q3/Q8).
 */
function seedStations(syncedAt: DateTime): StationRecord[] {
  return STATIONS.map((station) => ({
    id: station.aemetId,
    name: station.name,
    province: null,
    latitude: null,
    longitude: null,
    sourceStrategy: 'antartida',
    aggregationTimezone: station.aggregationTimezone,
    syncedAt,
  }));
}

/**
 * Keeps the station catalog in sync with the AEMET inventory (Q3). A failing
 * inventory fetch is never fatal: the existing catalog plus the seed rows
 * stay available.
 */
export class CatalogService {
  constructor(
    private readonly repo: StationCatalogRepository,
    private readonly inventoryClient: InventoryClient,
    private readonly now: () => DateTime = () => DateTime.now(),
  ) {}

  async sync(): Promise<void> {
    const syncedAt = this.now();
    try {
      const inventory = await this.inventoryClient.fetchAllStations();
      const rows = inventory
        .map((row) => inventoryRowToStation(row, syncedAt))
        .filter((row): row is StationRecord => row !== null);
      this.repo.upsertCatalog(rows);
    } catch {
      // High availability (Q8): keep serving whatever the catalog already has.
    }
    this.repo.upsertCatalog(seedStations(syncedAt));
  }
}
