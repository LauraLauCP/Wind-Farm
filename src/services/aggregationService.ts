import { DateTime } from 'luxon';
import { DATA_TYPES, type DataType } from '../domain/dataTypes.js';
import { toOutputIso } from './timeService.js';

/** Time aggregations supported by the API. "none" returns the raw 10-minute series. */
export const AGGREGATIONS = ['none', 'hourly', 'daily', 'monthly'] as const;

export type Aggregation = (typeof AGGREGATIONS)[number];

/** A single measurement normalized from the AEMET raw response (instant always in UTC). */
export interface NormalizedReading {
  readonly instant: DateTime;
  /** Value per data type; null when the source did not report it. */
  readonly values: Readonly<Record<DataType, number | null>>;
}

/**
 * One row of the output dataset. Only the data types requested by the user
 * are present as keys.
 */
export type DatasetRow = {
  /** ISO 8601 datetime in Europe/Madrid, including the CET/CEST offset. */
  readonly datetime: string;
  /** How many source readings were combined into this row (1 when aggregation is "none"). */
  readonly samples: number;
} & Partial<Record<DataType, number | null>>;

/** Maps each aggregation to the Luxon unit used to draw bucket boundaries. */
const AGGREGATION_UNIT: Record<Exclude<Aggregation, 'none'>, 'hour' | 'day' | 'month'> = {
  hourly: 'hour',
  daily: 'day',
  monthly: 'month',
};

/**
 * Builds the rows of the output dataset.
 *
 * - `none`: every reading is returned as-is (native 10-minute granularity).
 * - `hourly`/`daily`/`monthly`: readings are grouped into buckets whose
 *   boundaries are drawn in the station's time zone (`stationTimezone`), and
 *   each value becomes the arithmetic mean of the valid samples in the bucket.
 *   Missing source values are skipped, never treated as zero.
 *
 * The input is sorted chronologically (defensively — AEMET data is expected
 * in order but nothing should depend on that), so bucket order matches
 * insertion order.
 */
export function aggregateReadings(
  readings: readonly NormalizedReading[],
  aggregation: Aggregation,
  stationTimezone: string,
  selectedTypes: readonly DataType[],
): DatasetRow[] {
  const ordered = [...readings].sort((a, b) => a.instant.toMillis() - b.instant.toMillis());

  if (aggregation === 'none') {
    return ordered.map((reading) => ({
      datetime: toOutputIso(reading.instant),
      samples: 1,
      ...pickValues(reading.values, selectedTypes),
    }));
  }

  const unit = AGGREGATION_UNIT[aggregation];
  const buckets = new Map<
    string,
    { start: DateTime; sums: Record<DataType, number>; counts: Record<DataType, number>; samples: number }
  >();

  for (const reading of ordered) {
    const bucketStart = reading.instant.setZone(stationTimezone).startOf(unit);
    const key = bucketStart.toISO() ?? bucketStart.toMillis().toString();
    let bucket = buckets.get(key);
    if (bucket === undefined) {
      bucket = { start: bucketStart, sums: zeroCounters(), counts: zeroCounters(), samples: 0 };
      buckets.set(key, bucket);
    }
    bucket.samples += 1;
    for (const type of selectedTypes) {
      const value = reading.values[type];
      if (value !== null) {
        bucket.sums[type] += value;
        bucket.counts[type] += 1;
      }
    }
  }

  return [...buckets.values()].map((bucket) => ({
    datetime: toOutputIso(bucket.start),
    samples: bucket.samples,
    ...pickValues(meanValues(bucket.sums, bucket.counts), selectedTypes),
  }));
}

function zeroCounters(): Record<DataType, number> {
  return { temperature: 0, pressure: 0, speed: 0 };
}

/** Mean per data type over the samples that actually reported a value; null when none did. */
function meanValues(
  sums: Readonly<Record<DataType, number>>,
  counts: Readonly<Record<DataType, number>>,
): Record<DataType, number | null> {
  const result = {} as Record<DataType, number | null>;
  for (const type of DATA_TYPES) {
    result[type] = counts[type] > 0 ? roundTo2(sums[type] / counts[type]) : null;
  }
  return result;
}

/** Keeps only the data types the user selected, preserving their order. */
function pickValues(
  values: Readonly<Record<DataType, number | null>>,
  selectedTypes: readonly DataType[],
): Partial<Record<DataType, number | null>> {
  const picked: Partial<Record<DataType, number | null>> = {};
  for (const type of selectedTypes) {
    picked[type] = values[type] ?? null;
  }
  return picked;
}

function roundTo2(value: number): number {
  return Math.round(value * 100) / 100;
}
