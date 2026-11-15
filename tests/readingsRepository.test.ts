import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DateTime } from 'luxon';
import { ReadingsRepository, type StoredReading } from '../src/storage/readingsRepository.js';

/** Creates a throwaway directory so each test gets a fresh SQLite file. */
function freshRepo(): { repo: ReadingsRepository; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'windfarm-repo-'));
  const repo = new ReadingsRepository(join(dir, 'test.sqlite'));
  return { repo, cleanup: () => { repo.close(); rmSync(dir, { recursive: true, force: true }); } };
}

function storedReading(iso: string, product: StoredReading['product'], values: Partial<Pick<StoredReading, 'temperature' | 'pressure' | 'speed'>> = {}): StoredReading {
  return {
    instant: DateTime.fromISO(iso, { zone: 'utc' }),
    product,
    temperature: 'temperature' in values ? values.temperature : 10.5,
    pressure: 'pressure' in values ? values.pressure : 1000.25,
    speed: 'speed' in values ? values.speed : 3.5,
  };
}

describe('ReadingsRepository', () => {
  let cleanup: (() => void) | undefined;
  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
  });

  it('persists readings on a fresh database (migrations applied implicitly) and reads them back by range', () => {
    const { repo, cleanup: done } = freshRepo();
    cleanup = done;

    repo.upsertReadings('8178D', [
      storedReading('2026-11-02T00:00:00Z', 'climatology'),
      storedReading('2026-11-05T12:00:00Z', 'observation', { pressure: null }),
      storedReading('2026-11-15T00:00:00Z', 'observation'),
    ]);

    // Range is inclusive on both ends: the reading at 2026-11-05 is the end boundary.
    const read = repo.readRange(
      '8178D',
      DateTime.fromISO('2026-11-02T00:00:00Z'),
      DateTime.fromISO('2026-11-05T12:00:00Z'),
    );
    expect(read).toHaveLength(2);
    expect(read[0]).toEqual(storedReading('2026-11-02T00:00:00Z', 'climatology'));
    expect(read[1]).toEqual({
      instant: DateTime.fromISO('2026-11-05T12:00:00Z', { zone: 'utc' }),
      product: 'observation',
      temperature: 10.5,
      pressure: null,
      speed: 3.5,
    });

    // Another station sees nothing.
    expect(repo.readRange('89064', DateTime.fromISO('2026-11-01T00:00:00Z'), DateTime.fromISO('2026-11-30T00:00:00Z'))).toEqual([]);
  });

  it('replaces (upserts) readings with the same station, timestamp and product instead of duplicating', () => {
    const { repo, cleanup: done } = freshRepo();
    cleanup = done;

    repo.upsertReadings('8178D', [storedReading('2026-11-05T12:00:00Z', 'observation')]);
    repo.upsertReadings('8178D', [storedReading('2026-11-05T12:00:00Z', 'observation', { temperature: 42 })]);

    const read = repo.readRange('8178D', DateTime.fromISO('2026-11-01T00:00:00Z'), DateTime.fromISO('2026-11-30T00:00:00Z'));
    expect(read).toHaveLength(1);
    expect(read[0]?.temperature).toBe(42);
  });
});
