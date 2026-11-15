import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CatalogService, type InventoryClient } from '../src/services/stationCatalog.js';
import { StationCatalogRepository } from '../src/storage/stationCatalogRepository.js';
import inventory from './fixtures/aemet/inventario_full.json';

function freshCatalog(): {
  catalogRepo: StationCatalogRepository;
  service: (client: InventoryClient) => CatalogService;
  cleanup: () => void;
} {
  const dir = mkdtempSync(join(tmpdir(), 'windfarm-catalog-'));
  const catalogRepo = new StationCatalogRepository(join(dir, 'test.sqlite'));
  return {
    catalogRepo,
    service: (client: InventoryClient) => new CatalogService(catalogRepo, client),
    cleanup: () => {
      catalogRepo.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

describe('CatalogService', () => {
  let cleanup: (() => void) | undefined;
  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
  });

  it('syncs the inventory into the catalog with parsed coordinates and per-province time zones', async () => {
    const ctx = freshCatalog();
    cleanup = ctx.cleanup;

    const inventoryClient: InventoryClient = {
      fetchAllStations: vi.fn(async () => inventory as never),
    };
    await ctx.service(inventoryClient).sync();

    const lluc = ctx.catalogRepo.findStation('B013X');
    expect(lluc?.name).toBe('ESCORCA, LLUC');
    expect(lluc?.province).toBe('ILLES BALEARS');
    expect(lluc?.latitude).toBeCloseTo(39.823333, 4);
    expect(lluc?.longitude).toBeCloseTo(2.885833, 4);
    expect(lluc?.aggregationTimezone).toBe('Europe/Madrid');
    expect(lluc?.sourceStrategy).toBe('composite');

    // Canary Islands aggregate in their own zone (Q: per-station aggregation timezone).
    const tias = ctx.catalogRepo.findStation('C018J');
    expect(tias?.latitude).toBeCloseTo(28.969722, 4);
    expect(tias?.longitude).toBeCloseTo(-13.690278, 4);
    expect(tias?.aggregationTimezone).toBe('Atlantic/Canary');
  });

  it('always seeds the two Antarctic stations (they are absent from the AEMET inventory)', async () => {
    const ctx = freshCatalog();
    cleanup = ctx.cleanup;

    const emptyClient: InventoryClient = { fetchAllStations: vi.fn(async () => []) };
    await ctx.service(emptyClient).sync();

    const juanCarlos = ctx.catalogRepo.findStation('89064');
    expect(juanCarlos?.name).toBe('Meteo Station Juan Carlos I');
    expect(juanCarlos?.sourceStrategy).toBe('antartida');
    expect(juanCarlos?.aggregationTimezone).toBe('UTC');
    expect(ctx.catalogRepo.findStation('89070')?.name).toBe('Meteo Station Gabriel de Castilla');
  });

  it('keeps the catalog usable when the inventory endpoint is unreachable (high availability fallback)', async () => {
    const ctx = freshCatalog();
    cleanup = ctx.cleanup;

    const brokenClient: InventoryClient = {
      fetchAllStations: vi.fn(async () => {
        throw new Error('AEMET down');
      }),
    };
    await expect(ctx.service(brokenClient).sync()).resolves.toBeUndefined();

    // The seeds are present even though the sync failed.
    expect(ctx.catalogRepo.findStation('89064')?.sourceStrategy).toBe('antartida');
  });
});
