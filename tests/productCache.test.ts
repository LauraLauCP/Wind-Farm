import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DateTime } from 'luxon';
import { ReadingsRepository, type StoredReading } from '../src/storage/readingsRepository.js';
import { ProductCache, type ProductPolicy } from '../src/services/productCache.js';

function freshRepo(): { repo: ReadingsRepository; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'windfarm-cache-'));
  const repo = new ReadingsRepository(join(dir, 'test.sqlite'));
  return { repo, cleanup: () => { repo.close(); rmSync(dir, { recursive: true, force: true }); } };
}

/** One climatology-shaped policy with controllable knobs. */
const POLICY: ProductPolicy = {
  product: 'climatology',
  /** Mutable horizon: AEMET publishes daily climatology with ~4 days of delay. */
  horizonMs: 5 * 24 * 60 * 60 * 1000,
  /** Refresh TTL for chunks inside the mutable horizon. */
  ttlMs: 6 * 60 * 60 * 1000,
  /** Chunk width, aligned with the climatology 10-day request cap. */
  chunkDays: 10,
};

function reading(iso: string, over: Partial<Omit<StoredReading, 'instant'>> = {}): StoredReading {
  return {
    instant: DateTime.fromISO(iso, { zone: 'utc' }),
    product: 'climatology',
    temperature: over.temperature ?? 14.2,
    pressure: over.pressure ?? 942.7,
    speed: over.speed ?? 1.4,
  };
}

describe('ProductCache', () => {
  let cleanup: (() => void) | undefined;
  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
  });

  it('serves an immutable-history range from SQLite on the second call without re-fetching upstream', async () => {
    const { repo, cleanup: done } = freshRepo();
    cleanup = done;

    const fetchChunk = vi.fn(async (_start: DateTime, _end: DateTime): Promise<StoredReading[]> => [
      reading('2026-11-02T00:00:00Z'),
      reading('2026-11-05T00:00:00Z'),
    ]);
    // Fixed clock: now = Nov 15. The requested range (Nov 1-10) lies entirely
    // before the mutable horizon (now - 5 days = Nov 10), so it is immutable history.
    const now = DateTime.fromISO('2026-11-15T12:00:00Z', { zone: 'utc' });
    const cache = new ProductCache('8178D', repo, fetchChunk, POLICY, () => now);

    const first = await cache.getRange(
      DateTime.fromISO('2026-11-01T00:00:00Z', { zone: 'utc' }),
      DateTime.fromISO('2026-11-10T00:00:00Z', { zone: 'utc' }),
    );

    expect(fetchChunk).toHaveBeenCalledTimes(1);
    expect(first.readings).toHaveLength(2);
    expect(first.stale).toBe(false);
    expect(first.lastSyncedAt?.toISO()).toBe(now.toISO());

    // Second call for the same immutable range: served from SQLite, no upstream call.
    const second = await cache.getRange(
      DateTime.fromISO('2026-11-01T00:00:00Z', { zone: 'utc' }),
      DateTime.fromISO('2026-11-10T00:00:00Z', { zone: 'utc' }),
    );
    expect(fetchChunk).toHaveBeenCalledTimes(1);
    expect(second.readings).toEqual(first.readings);
    expect(second.stale).toBe(false);
    expect(second.lastSyncedAt?.toISO()).toBe(now.toISO());
  });
});
