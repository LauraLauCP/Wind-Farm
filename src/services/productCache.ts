import { DateTime } from 'luxon';
import { splitIntoWindows } from '../domain/timeWindows.js';
import { ReadingsRepository, type ProductName, type StoredReading } from '../storage/readingsRepository.js';

/** Freshness policy of one AEMET product (Q10: mutability horizon + TTL + chunk width). */
export interface ProductPolicy {
  readonly product: ProductName;
  /**
   * Mutability horizon (ms before "now"): a chunk that lies entirely before
   * it can never change upstream, so once cached it is a permanent hit.
   */
  readonly horizonMs: number;
  /** Chunks inside the horizon are re-fetched when their last sync is older than this TTL. */
  readonly ttlMs: number;
  /** Chunk width in days, aligned with the product's upstream request cap. */
  readonly chunkDays: number;
}

/** Result of serving a range through the cache. */
export interface ServedRange {
  readonly readings: readonly StoredReading[];
  /** True when data was served although the refresh attempt failed (Q8: serve-stale). */
  readonly stale: boolean;
  /** When the served data was last synchronized from upstream (null when nothing was served). */
  readonly lastSyncedAt: DateTime | null;
}

/** Fetches the readings of one product for one chunk; implemented per AEMET client. */
export type ChunkFetcher = (start: DateTime, end: DateTime) => Promise<readonly StoredReading[]>;

/**
 * Read-through cache for one station + product (Q1, Q10): serves every range
 * from SQLite, fetching from upstream exactly the chunks that are missing or
 * no longer fresh. Chunked, gap-aware and auditable via `range_sync`.
 */
export class ProductCache {
  /** In-flight fetches per chunk (Q11: single-flight stampede protection). */
  private readonly inFlight = new Map<string, Promise<void>>();

  constructor(
    private readonly stationId: string,
    private readonly repo: ReadingsRepository,
    private readonly fetchChunk: ChunkFetcher,
    private readonly policy: ProductPolicy,
    private readonly now: () => DateTime = () => DateTime.now(),
  ) {}

  async getRange(startUtc: DateTime, endUtc: DateTime): Promise<ServedRange> {
    const now = this.now();
    const mutableSince = now.minus(this.policy.horizonMs);
    let stale = false;
    let newestSync: DateTime | null = null;

    for (const chunk of splitIntoWindows(startUtc, endUtc, this.policy.chunkDays)) {
      const immutable = chunk.end <= mutableSince;
      const syncedAt = this.repo.getSyncStamp(this.stationId, this.policy.product, chunk.start, chunk.end);
      const fresh =
        syncedAt !== null &&
        (immutable || now.diff(syncedAt).toMillis() < this.policy.ttlMs);

      if (fresh && syncedAt !== null) {
        newestSync = newestSync === null ? syncedAt : DateTime.max(newestSync, syncedAt);
        continue;
      }

      // Missing or stale chunk: fetch it (Q11: concurrent callers of the same
      // chunk share one in-flight fetch instead of stampeding the upstream).
      const key = `${chunk.start.toUTC().toMillis()}-${chunk.end.toUTC().toMillis()}`;
      let task = this.inFlight.get(key);
      if (task === undefined) {
        task = this.refreshChunk(chunk.start, chunk.end);
        this.inFlight.set(key, task);
        task.finally(() => this.inFlight.delete(key)).catch(() => {});
      }
      await task;

      const stampAfter = this.repo.getSyncStamp(this.stationId, this.policy.product, chunk.start, chunk.end);
      if (stampAfter !== null && (syncedAt === null || stampAfter > syncedAt)) {
        // The refresh succeeded (a newer sync stamp was recorded).
        newestSync = newestSync === null ? stampAfter : DateTime.max(newestSync, stampAfter);
      } else {
        // Q8: the refresh failed; serve whatever is stored and flag it stale.
        stale = true;
        if (syncedAt !== null) {
          newestSync = newestSync === null ? syncedAt : DateTime.max(newestSync, syncedAt);
        }
      }
    }

    const readings = this.repo.readRange(this.stationId, startUtc, endUtc);
    return { readings, stale, lastSyncedAt: newestSync };
  }

  /** Fetches, stores and records the sync of one chunk; never rejects (failure is detected via the unchanged stamp). */
  private async refreshChunk(start: DateTime, end: DateTime): Promise<void> {
    try {
      const readings = await this.fetchChunk(start, end);
      this.repo.upsertReadings(this.stationId, readings);
      this.repo.recordSync(this.stationId, this.policy.product, start, end, this.now());
    } catch {
      // Swallow: the caller detects the failure through the missing/unchanged sync stamp.
    }
  }
}
