import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DateTime } from 'luxon';
import { ReadingsRepository } from '../src/storage/readingsRepository.js';
import { StationDataService } from '../src/services/stationDataService.js';
import type { StationRecord } from '../src/storage/stationCatalogRepository.js';
import type { AemetRawReading } from '../src/client/aemetClient.js';
import type { ObsReading } from '../src/client/obsClient.js';
import type { DailyClimatologyRecord } from '../src/client/climatologyClient.js';
import { DATA_TYPES } from '../src/domain/dataTypes.js';

const ALBACETE: StationRecord = {
  id: '8178D',
  name: 'ALBACETE',
  province: 'ALBACETE',
  latitude: 39.0,
  longitude: -1.86,
  sourceStrategy: 'composite',
  aggregationTimezone: 'Europe/Madrid',
  syncedAt: null,
};

const NOW = DateTime.fromISO('2026-11-15T12:00:00Z', { zone: 'utc' });

function freshService(): {
  service: StationDataService;
  antartida: ReturnType<typeof vi.fn>;
  observations: ReturnType<typeof vi.fn>;
  climatology: ReturnType<typeof vi.fn>;
  cleanup: () => void;
} {
  const dir = mkdtempSync(join(tmpdir(), 'windfarm-datos-'));
  const repo = new ReadingsRepository(join(dir, 'test.sqlite'));
  const antartida = vi.fn(async (): Promise<AemetRawReading[]> => []);
  const observations = vi.fn(async (): Promise<ObsReading[]> => []);
  const climatology = vi.fn(async (): Promise<DailyClimatologyRecord[]> => []);
  const service = new StationDataService(repo, { antartida, observations, climatology }, () => NOW);
  return { service, antartida, observations, climatology, cleanup: () => { repo.close(); rmSync(dir, { recursive: true, force: true }); } };
}

describe('StationDataService', () => {
  let cleanup: (() => void) | undefined;
  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
  });

  it('serves a composite station by merging climatology history with recent observations, labeled by granularity', async () => {
    const ctx = freshService();
    cleanup = ctx.cleanup;

    // Climatology covers the historical part (chunks of <= 10 days).
    ctx.climatology.mockImplementation(async (start: DateTime) => {
      // First chunk (Nov 1 -> Nov 11) has three days; the second chunk is empty.
      if (start.toISO()?.startsWith('2026-11-01')) {
        return [
          { date: '2026-11-01', temperature: 14.2, pressure: 942.7, speed: 1.4 },
          { date: '2026-11-02', temperature: 13.2, pressure: 941.35, speed: 0.8 },
          { date: '2026-11-03', temperature: 13.0, pressure: 936.45, speed: 1.1 },
        ];
      }
      return [];
    });
    // Observations cover the last ~24 hours.
    ctx.observations.mockResolvedValue([
      { instant: DateTime.fromISO('2026-11-15T10:00:00Z', { zone: 'utc' }), temperature: 10.0, pressure: 943.1, speed: 0.8 },
      { instant: DateTime.fromISO('2026-11-15T11:00:00Z', { zone: 'utc' }), temperature: 10.5, pressure: 943.0, speed: 1.0 },
    ]);

    const dataset = await ctx.service.getDataset(
      ALBACETE,
      DateTime.fromISO('2026-11-01T00:00:00Z', { zone: 'utc' }),
      DateTime.fromISO('2026-11-15T12:00:00Z', { zone: 'utc' }),
      'none',
      [...DATA_TYPES],
    );

    // The observation product is only asked for the recent window, the
    // climatology product for the historical part.
    expect(ctx.observations).toHaveBeenCalledTimes(1);
    expect(ctx.climatology).toHaveBeenCalledTimes(2); // two chunks over 13.5 days of history

    expect(dataset.rows).toHaveLength(5);
    // Climatology days anchor to the station's local midnight (Madrid, CET in November).
    expect(dataset.rows[0]).toEqual({
      datetime: '2026-11-01T00:00:00+01:00',
      granularity: 'daily',
      samples: null,
      temperature: 14.2,
      pressure: 942.7,
      speed: 1.4,
    });
    expect(dataset.rows[2]?.datetime).toBe('2026-11-03T00:00:00+01:00');
    // Recent observations keep their native cadence.
    expect(dataset.rows[3]).toEqual({
      datetime: '2026-11-15T11:00:00+01:00',
      granularity: 'observation',
      samples: 1,
      temperature: 10.0,
      pressure: 943.1,
      speed: 0.8,
    });
    expect(dataset.rows[4]?.datetime).toBe('2026-11-15T12:00:00+01:00');

    expect(dataset.stale).toBe(false);
    expect(dataset.partial).toBe(false);
    expect(dataset.lastSyncedAt?.toISO()).toBe(NOW.toISO());
  });
});
