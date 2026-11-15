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

      if (!fresh) {
        try {
          const readings = await this.fetchChunk(chunk.start, chunk.end);
          this.repo.upsertReadings(this.stationId, readings);
          const syncedNow = this.now();
          this.repo.recordSync(this.stationId, this.policy.product, chunk.start, chunk.end, syncedNow);
          newestSync = newestSync === null ? syncedNow : DateTime.max(newestSync, syncedNow);
        } catch {
          // Q8: an upstream failure never wipes usable data; fall back to
          // whatever is stored and flag the response as stale.
          stale = true;
        }
      } else if (syncedAt !== null) {
        newestSync = newestSync === null ? syncedAt : DateTime.max(newestSync, syncedAt);
      }
    }

    const readings = this.repo.readRange(this.stationId, startUtc, endUtc);
    return { readings, stale, lastSyncedAt: newestSync };
  }
}
