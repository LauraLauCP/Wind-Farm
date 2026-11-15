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

  it('re-fetches a mutable chunk only after its TTL expires, and serves newer values', async () => {
    const { repo, cleanup: done } = freshRepo();
    cleanup = done;

    const readingsByCall = [
      [reading('2026-11-14T00:00:00Z', { temperature: 10 })],
      [reading('2026-11-14T00:00:00Z', { temperature: 20 })],
    ];
    let call = 0;
    const fetchChunk = vi.fn(async () => readingsByCall[Math.min(call++, readingsByCall.length - 1)] ?? []);

    // Mutable zone: the requested day (Nov 14) is inside the 5-day horizon of "Nov 15".
    let now = DateTime.fromISO('2026-11-15T12:00:00Z', { zone: 'utc' });
    const cache = new ProductCache('8178D', repo, fetchChunk, POLICY, () => now);
    const start = DateTime.fromISO('2026-11-14T00:00:00Z', { zone: 'utc' });
    const end = DateTime.fromISO('2026-11-15T00:00:00Z', { zone: 'utc' });

    const first = await cache.getRange(start, end);
    expect(first.readings[0]?.temperature).toBe(10);

    // 30 minutes later: still within the 6h TTL -> cache hit, no re-fetch.
    now = DateTime.fromISO('2026-11-15T12:30:00Z', { zone: 'utc' });
    const stillFresh = await cache.getRange(start, end);
    expect(fetchChunk).toHaveBeenCalledTimes(1);
    expect(stillFresh.readings[0]?.temperature).toBe(10);

    // 7 hours after the sync: TTL expired -> re-fetch, newer values replace the old.
    now = DateTime.fromISO('2026-11-15T19:00:00Z', { zone: 'utc' });
    const refreshed = await cache.getRange(start, end);
    expect(fetchChunk).toHaveBeenCalledTimes(2);
    expect(refreshed.readings[0]?.temperature).toBe(20);
    expect(refreshed.stale).toBe(false);
  });

  it('deduplicates concurrent fetches of the same chunk (single-flight)', async () => {
    const { repo, cleanup: done } = freshRepo();
    cleanup = done;

    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetchChunk = vi.fn(async (): Promise<StoredReading[]> => {
      await gate;
      return [reading('2026-11-02T00:00:00Z')];
    });

    const now = DateTime.fromISO('2026-11-15T12:00:00Z', { zone: 'utc' });
    const cache = new ProductCache('8178D', repo, fetchChunk, POLICY, () => now);
    const start = DateTime.fromISO('2026-11-01T00:00:00Z', { zone: 'utc' });
    const end = DateTime.fromISO('2026-11-10T00:00:00Z', { zone: 'utc' });

    // Two identical requests race on a cold cache; both reach the fetch
    // decision point while the (single) upstream call is still in flight.
    const firstPromise = cache.getRange(start, end);
    const secondPromise = cache.getRange(start, end);
    setTimeout(release, 50);
    const [first, second] = await Promise.all([firstPromise, secondPromise]);

    expect(fetchChunk).toHaveBeenCalledTimes(1);
    expect(first.readings).toEqual(second.readings);
    expect(first.stale).toBe(false);
    expect(second.stale).toBe(false);
  });

  it('serves stale data with a flag when the refresh fetch fails', async () => {
    const { repo, cleanup: done } = freshRepo();
    cleanup = done;

    const fetchChunk = vi.fn(async (): Promise<StoredReading[]> => [reading('2026-11-14T00:00:00Z')]);
    let now = DateTime.fromISO('2026-11-15T12:00:00Z', { zone: 'utc' });
    const cache = new ProductCache('8178D', repo, fetchChunk, POLICY, () => now);
    const start = DateTime.fromISO('2026-11-14T00:00:00Z', { zone: 'utc' });
    const end = DateTime.fromISO('2026-11-15T00:00:00Z', { zone: 'utc' });

    await cache.getRange(start, end); // populates the cache

    // TTL expires and upstream breaks: the stored data must still be served.
    now = DateTime.fromISO('2026-11-15T19:00:00Z', { zone: 'utc' });
    fetchChunk.mockRejectedValue(new Error('upstream down'));
    const served = await cache.getRange(start, end);

    expect(served.stale).toBe(true);
    expect(served.readings).toHaveLength(1);
    expect(served.readings[0]?.temperature).toBe(14.2);
    // lastSyncedAt reflects when the data was actually last fetched from upstream.
    expect(served.lastSyncedAt?.toISO()).toBe(DateTime.fromISO('2026-11-15T12:00:00Z', { zone: 'utc' }).toISO());
  });
});
