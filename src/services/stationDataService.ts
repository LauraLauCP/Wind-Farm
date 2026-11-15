import { DateTime } from 'luxon';
import type { AemetRawReading } from '../client/aemetClient.js';
import type { DailyClimatologyRecord } from '../client/climatologyClient.js';
import type { ObsReading } from '../client/obsClient.js';
import { DATA_TYPES, type DataType } from '../domain/dataTypes.js';
import type { StationRecord } from '../storage/stationCatalogRepository.js';
import type { ProductName, StoredReading } from '../storage/readingsRepository.js';
import { ReadingsRepository } from '../storage/readingsRepository.js';
import { aggregateReadings, type Aggregation, type DatasetRow } from './aggregationService.js';
import { normalizeReadings } from './antartidaService.js';
import { ProductCache, type ProductPolicy, type ServedRange } from './productCache.js';

/** Upstream sources, injected so tests never touch the network. */
export interface StationSources {
  /** Raw AEMET "antartida" product records (the two Antarctic stations). */
  antartida(startUtc: DateTime, endUtc: DateTime, aemetStationId: string): Promise<AemetRawReading[]>;
  /** Conventional observations (last ~24 h, station-dependent cadence). */
  observations(idema: string): Promise<ObsReading[]>;
  /** Daily climatology, any historical range. */
  climatology(startUtc: DateTime, endUtc: DateTime, idema: string): Promise<DailyClimatologyRecord[]>;
}

/** One output row of the generalized dataset. */
export interface StationDatasetRow extends Omit<DatasetRow, 'samples'> {
  /** Which upstream tier the row came from (Q9: honesty about granularity). */
  readonly granularity: 'observation' | 'daily';
  /** Number of source readings combined; null for source-provided daily summaries. */
  readonly samples: number | null;
}

/** The assembled dataset of one station query, with cache metadata (Q16). */
export interface StationDataset {
  readonly rows: readonly StationDatasetRow[];
  readonly stale: boolean;
  readonly partial: boolean;
  readonly lastSyncedAt: DateTime | null;
}

/** Freshness policies per product (Q10), with env-overridable defaults. */
const POLICIES: Record<ProductName, ProductPolicy> = {
  // The antartida product publishes new readings only a few times per day.
  antartida: { product: 'antartida', horizonMs: 72 * 60 * 60 * 1000, ttlMs: 30 * 60 * 1000, chunkDays: 7 },
  // Upstream keeps roughly the last 24 hours of conventional observations.
  observation: { product: 'observation', horizonMs: 24 * 60 * 60 * 1000, ttlMs: 15 * 60 * 1000, chunkDays: 1 },
  // Daily climatology publishes with ~4 days of delay. Daily rows anchor to
  // local midnight, so readback pads a day (+ DST safety) to catch the day
  // whose UTC instant precedes the range start.
  climatology: {
    product: 'climatology',
    horizonMs: 5 * 24 * 60 * 60 * 1000,
    ttlMs: 6 * 60 * 60 * 1000,
    chunkDays: 10,
    readPadMs: 26 * 60 * 60 * 1000,
  },
};

/** How much of the recent window the observation product can cover. */
const OBSERVATION_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Assembles the generalized dataset of any station (Q2/Q9): a two-tier
 * composite for regular stations (observations for the recent window,
 * climatology for history) and the antartida product for the Antarctic ones.
 * Every product goes through its `ProductCache`, so repeated queries hit
 * SQLite instead of AEMET.
 */
export class StationDataService {
  private readonly caches = new Map<string, ProductCache>();

  constructor(
    private readonly repo: ReadingsRepository,
    private readonly sources: StationSources,
    private readonly now: () => DateTime = () => DateTime.now(),
  ) {}

  async getDataset(
    station: StationRecord,
    startUtc: DateTime,
    endUtc: DateTime,
    aggregation: Aggregation,
    types: readonly DataType[],
  ): Promise<StationDataset> {
    const selectedTypes = types.length === 0 ? [...DATA_TYPES] : types;
    const ranges: Array<{ product: ProductName; start: DateTime; end: DateTime }> =
      station.sourceStrategy === 'antartida'
        ? [{ product: 'antartida', start: startUtc, end: endUtc }]
        : this.compositeRanges(startUtc, endUtc);

    const parts: Array<{ rows: StationDatasetRow[]; served: ServedRange }> = [];
    for (const { product, start, end } of ranges) {
      const served = await this.cacheFor(station, product).getRange(start, end);
      parts.push({ rows: this.buildRows(station, product, served.readings, aggregation, selectedTypes), served });
    }

    const sorted = parts
      .flatMap((part) => part.rows)
      .sort((a, b) => DateTime.fromISO(a.datetime).toMillis() - DateTime.fromISO(b.datetime).toMillis());
    const rows = this.deduplicateBuckets(sorted);

    const staleParts = parts.filter((part) => part.served.stale);
    const syncStamps: DateTime[] = [];
    for (const part of parts) {
      if (part.served.lastSyncedAt !== null) {
        syncStamps.push(part.served.lastSyncedAt);
      }
    }
    return {
      rows,
      stale: staleParts.length > 0,
      partial: staleParts.length > 0 && staleParts.length < parts.length,
      lastSyncedAt: syncStamps.length === 0 ? null : (DateTime.max(...syncStamps) ?? null),
    };
  }

  /** Composite split (Q9): observations own the last ~24 h, climatology the rest. */
  private compositeRanges(startUtc: DateTime, endUtc: DateTime): Array<{ product: ProductName; start: DateTime; end: DateTime }> {
    const now = this.now();
    // Clamp the recent window to the requested range: a query that ends
    // before the last 24 h must not over-fetch history up to "now".
    const obsStart = DateTime.max(startUtc, DateTime.min(endUtc, now.minus(OBSERVATION_WINDOW_MS)));
    const ranges: Array<{ product: ProductName; start: DateTime; end: DateTime }> = [];
    if (startUtc < obsStart) {
      ranges.push({ product: 'climatology', start: startUtc, end: obsStart });
    }
    if (obsStart < endUtc) {
      ranges.push({ product: 'observation', start: obsStart, end: endUtc });
    }
    return ranges;
  }

  private cacheFor(station: StationRecord, product: ProductName): ProductCache {
    const key = `${station.id}:${product}`;
    let cache = this.caches.get(key);
    if (cache === undefined) {
      cache = new ProductCache(
        station.id,
        this.repo,
        this.fetcherFor(station, product),
        POLICIES[product],
        this.now,
      );
      this.caches.set(key, cache);
    }
    return cache;
  }

  /** Adapts each upstream source to the cache's chunk-fetcher contract. */
  private fetcherFor(station: StationRecord, product: ProductName) {
    switch (product) {
      case 'antartida':
        return async (start: DateTime, end: DateTime): Promise<StoredReading[]> =>
          normalizeReadings(await this.sources.antartida(start, end, station.id)).map((reading) => ({
            instant: reading.instant,
            product,
            temperature: reading.values.temperature,
            pressure: reading.values.pressure,
            speed: reading.values.speed,
          }));
      case 'observation':
        return async (start: DateTime, end: DateTime): Promise<StoredReading[]> =>
          (await this.sources.observations(station.id))
            .filter((reading) => reading.instant >= start && reading.instant <= end)
            .map((reading) => ({ ...reading, product }));
      case 'climatology':
        return async (start: DateTime, end: DateTime): Promise<StoredReading[]> =>
          // No instant filtering here: AEMET already scopes by calendar date,
          // and the date -> local-midnight mapping can legitimately shift an
          // instant outside the UTC chunk bounds.
          (await this.sources.climatology(start, end, station.id)).map((record) => ({
            instant: DateTime.fromISO(`${record.date}T00:00:00`, { zone: station.aggregationTimezone }),
            product,
            temperature: record.temperature,
            pressure: record.pressure,
            speed: record.speed,
          }));
    }
  }

  /** Turns stored readings into output rows for the requested aggregation. */
  private buildRows(
    station: StationRecord,
    product: ProductName,
    readings: readonly StoredReading[],
    aggregation: Aggregation,
    selectedTypes: readonly DataType[],
  ): StationDatasetRow[] {
    const granularity: StationDatasetRow['granularity'] = product === 'climatology' ? 'daily' : 'observation';

    if (product === 'climatology' && (aggregation === 'none' || aggregation === 'hourly' || aggregation === 'daily')) {
      // Source-provided daily summaries: honest pass-through (an hourly
      // bucket cannot be subdivided from a daily value).
      return readings.map((reading) => ({
        datetime: toIso(reading.instant),
        granularity,
        samples: null,
        ...pick(reading, selectedTypes),
      }));
    }

    // Sample-based readings (and monthly buckets over climatology days) are
    // aggregated with the Part 1 logic, drawn in the station's time zone.
    const normalized = readings.map((reading) => ({
      instant: reading.instant,
      values: { temperature: reading.temperature, pressure: reading.pressure, speed: reading.speed },
    }));
    return aggregateReadings(normalized, aggregation, station.aggregationTimezone, selectedTypes).map((row) => ({
      ...row,
      granularity,
    }));
  }

  /**
   * When both tiers produce a row for the same bucket (e.g. the boundary day
   * covered by observations and climatology), the observation tier wins:
   * it is fresher and sample-based.
   */
  private deduplicateBuckets(rows: readonly StationDatasetRow[]): StationDatasetRow[] {
    const result: StationDatasetRow[] = [];
    for (const row of rows) {
      const previous = result[result.length - 1];
      if (previous !== undefined && previous.datetime === row.datetime) {
        if (row.granularity === 'observation' && previous.granularity === 'daily') {
          result[result.length - 1] = row;
        }
        continue;
      }
      result.push(row);
    }
    return result;
  }
}

function toIso(instant: DateTime): string {
  return instant.setZone('Europe/Madrid').toISO({ suppressMilliseconds: true }) ?? instant.toISO() ?? '';
}

function pick(reading: StoredReading, selectedTypes: readonly DataType[]): Partial<Record<DataType, number | null>> {
  const picked: Partial<Record<DataType, number | null>> = {};
  for (const type of selectedTypes) {
    picked[type] = reading[type];
  }
  return picked;
}
