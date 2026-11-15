import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DateTime } from 'luxon';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { AemetClient } from '../src/client/aemetClient.js';
import { ReadingsRepository } from '../src/storage/readingsRepository.js';
import { StationCatalogRepository, type StationRecord } from '../src/storage/stationCatalogRepository.js';
import { StationDataService } from '../src/services/stationDataService.js';

const NOW = DateTime.fromISO('2026-11-15T12:00:00Z', { zone: 'utc' });

/** Literal stations: the source of truth for every assertion in this file. */
const STATIONS: readonly StationRecord[] = [
  {
    id: '3129',
    name: 'BARAJAS',
    province: 'MADRID',
    latitude: 40.47,
    longitude: -3.56,
    sourceStrategy: 'composite',
    aggregationTimezone: 'Europe/Madrid',
    syncedAt: NOW,
  },
  {
    id: '8178D',
    name: 'ALBACETE',
    province: 'ALBACETE',
    latitude: 40.0,
    longitude: -1.86,
    sourceStrategy: 'composite',
    aggregationTimezone: 'Europe/Madrid',
    syncedAt: NOW,
  },
  {
    id: '89064',
    name: 'JUAN CARLOS I',
    province: null,
    latitude: -62.66,
    longitude: -60.39,
    sourceStrategy: 'antartida',
    aggregationTimezone: 'Atlantic/Canary',
    syncedAt: NOW,
  },
  {
    id: '89070',
    name: 'GABRIEL DE CASTILLA',
    province: null,
    latitude: -62.72,
    longitude: -61.12,
    sourceStrategy: 'antartida',
    aggregationTimezone: 'Atlantic/Canary',
    syncedAt: NOW,
  },
];

/** Minimal stack: only the catalog matters here; the data service is a stub. */
async function buildStack() {
  const dir = mkdtempSync(join(tmpdir(), 'windfarm-estaciones-'));
  const readingsRepo = new ReadingsRepository(join(dir, 'test.sqlite'));
  const catalogRepo = new StationCatalogRepository(join(dir, 'test.sqlite'));
  catalogRepo.upsertCatalog(STATIONS);

  const service = new StationDataService(
    readingsRepo,
    { antartida: vi.fn(async () => []), observations: vi.fn(async () => []), climatology: vi.fn(async () => []) },
    () => NOW,
  );

  const app = createApp(new AemetClient('https://aemet.invalid', 'unused-key'), {
    catalogRepo,
    readingsRepo,
    stationDataService: service,
  });
  return {
    app,
    cleanup: () => {
      readingsRepo.close();
      catalogRepo.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

describe('GET /api/estaciones', () => {
  let stack: Awaited<ReturnType<typeof buildStack>>;
  beforeAll(async () => {
    stack = await buildStack();
  });
  afterAll(() => {
    stack.cleanup();
  });

  it('returns the catalog stations for the picker', async () => {
    const response = await request(stack.app).get('/api/estaciones').expect(200);

    expect(response.body).toEqual({
      count: 4,
      stations: [
        { id: '3129', name: 'BARAJAS', province: 'MADRID', latitude: 40.47, longitude: -3.56 },
        { id: '8178D', name: 'ALBACETE', province: 'ALBACETE', latitude: 40.0, longitude: -1.86 },
        { id: '89064', name: 'JUAN CARLOS I', province: null, latitude: -62.66, longitude: -60.39 },
        { id: '89070', name: 'GABRIEL DE CASTILLA', province: null, latitude: -62.72, longitude: -61.12 },
      ],
    });
  });

  it('filters stations by a case-insensitive name match', async () => {
    const response = await request(stack.app).get('/api/estaciones?search=juan').expect(200);

    expect(response.body).toEqual({
      count: 1,
      stations: [{ id: '89064', name: 'JUAN CARLOS I', province: null, latitude: -62.66, longitude: -60.39 }],
    });
  });

  it('matches search against the station id and the province', async () => {
    const byId = await request(stack.app).get('/api/estaciones?search=8178').expect(200);
    expect(byId.body.count).toBe(1);
    expect(byId.body.stations[0].id).toBe('8178D');

    // 'madrid' only appears in BARAJAS' province, never in its name.
    const byProvince = await request(stack.app).get('/api/estaciones?search=madrid').expect(200);
    expect(byProvince.body.count).toBe(1);
    expect(byProvince.body.stations[0].id).toBe('3129');
  });

  it('caps the number of returned stations with ?limit=', async () => {
    const response = await request(stack.app).get('/api/estaciones?limit=2').expect(200);

    expect(response.body.count).toBe(2);
    expect(response.body.stations.map((station: { id: string }) => station.id)).toEqual(['3129', '8178D']);
  });

  it('rejects a non-numeric limit with a 400', async () => {
    const response = await request(stack.app).get('/api/estaciones?limit=lots').expect(400);
    expect(response.body.error.code).toBe('bad_request');
  });
});
