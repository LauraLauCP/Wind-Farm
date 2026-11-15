import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DateTime } from 'luxon';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { AemetClient } from '../src/client/aemetClient.js';
import { ReadingsRepository } from '../src/storage/readingsRepository.js';
import { StationCatalogRepository } from '../src/storage/stationCatalogRepository.js';
import { CatalogService } from '../src/services/stationCatalog.js';
import { StationDataService } from '../src/services/stationDataService.js';
import inventarioSample from './fixtures/aemet/inventario_sample.json';

const NOW = DateTime.fromISO('2026-11-15T12:00:00Z', { zone: 'utc' });

/** Full stack with the same temp DB for catalog + readings, fakes upstream. */
async function buildStack() {
  const dir = mkdtempSync(join(tmpdir(), 'windfarm-datosapi-'));
  const readingsRepo = new ReadingsRepository(join(dir, 'test.sqlite'));
  const catalogRepo = new StationCatalogRepository(join(dir, 'test.sqlite'));

  const service = new StationDataService(
    readingsRepo,
    {
      antartida: vi.fn(async () => []),
      observations: vi.fn(async () => [
        { instant: DateTime.fromISO('2026-11-15T10:00:00Z', { zone: 'utc' }), temperature: 10.0, pressure: 943.1, speed: 0.8 },
      ]),
      climatology: vi.fn(async (start: DateTime) =>
        start.toISO()?.startsWith('2026-11-01')
          ? [{ date: '2026-11-02', temperature: 13.2, pressure: 941.35, speed: 0.8 }]
          : [],
      ),
    },
    () => NOW,
  );

  // Seed the catalog from the sample inventory fixture (8178D present) + the Antarctic seeds.
  await new CatalogService(catalogRepo, { fetchAllStations: vi.fn(async () => inventarioSample as never) }, () => NOW).sync();

  const app = createApp(new AemetClient('https://aemet.invalid', 'unused-key'), { catalogRepo, readingsRepo, stationDataService: service });
  return { app, cleanup: () => { readingsRepo.close(); catalogRepo.close(); rmSync(dir, { recursive: true, force: true }); } };
}

describe('GET /api/datos', () => {
  let stack: Awaited<ReturnType<typeof buildStack>>;
  beforeAll(async () => {
    stack = await buildStack();
  });
  afterAll(() => {
    stack.cleanup();
  });

  it('serves any catalog station with the cache metadata contract', async () => {
    const response = await request(stack.app)
      .get('/api/datos/fechaini/2026-11-01T00:00:00/fechafin/2026-11-15T12:00:00/estacion/8178D')
      .expect(200);

    expect(response.body).toMatchObject({
      station: 'ALBACETE',
      stationId: '8178D',
      timezone: 'Europe/Madrid',
      aggregation: 'none',
      stale: false,
      partial: false,
      count: 2,
    });
    expect(response.body.types).toEqual(['temperature', 'pressure', 'speed']);
    expect(response.body.data[0]).toEqual({
      datetime: '2026-11-02T00:00:00+01:00',
      granularity: 'daily',
      samples: null,
      temperature: 13.2,
      pressure: 941.35,
      speed: 0.8,
    });
    expect(response.body.data[1]).toMatchObject({ granularity: 'observation', samples: 1 });
    expect(response.body.lastSyncedAt).toBe('2026-11-15T13:00:00+01:00');
  });

  it('rejects an unknown station with a 400 listing the two seeded ones', async () => {
    const response = await request(stack.app)
      .get('/api/datos/fechaini/2026-11-01T00:00:00/fechafin/2026-11-02T00:00:00/estacion/UNKNOWN1')
      .expect(400);
    expect(response.body.error.code).toBe('bad_request');
    expect(response.body.error.message).toContain('UNKNOWN1');
  });

  it('serves the seeded Antarctic stations through the antartida product', async () => {
    // The antartida source is a fake returning nothing here: we only assert
    // the station resolves and the antartida strategy path executes (200).
    const response = await request(stack.app)
      .get('/api/datos/fechaini/2026-11-01T00:00:00/fechafin/2026-11-02T00:00:00/estacion/89064')
      .expect(200);
    expect(response.body).toMatchObject({ stationId: '89064', aggregation: 'none' });
    expect(response.body.data).toEqual([]);
  });

  it('filters the requested data types', async () => {
    const response = await request(stack.app)
      .get('/api/datos/fechaini/2026-11-01T00:00:00/fechafin/2026-11-15T12:00:00/estacion/8178D?types=temperature')
      .expect(200);
    expect(response.body.types).toEqual(['temperature']);
    expect(response.body.data[0]).toEqual({
      datetime: '2026-11-02T00:00:00+01:00',
      granularity: 'daily',
      samples: null,
      temperature: 13.2,
    });
  });

  it('reports liveness on /api/health', async () => {
    const response = await request(stack.app).get('/api/health').expect(200);
    expect(response.body).toEqual({ status: 'ok' });
  });
});
