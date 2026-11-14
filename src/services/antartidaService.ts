import { DateTime } from 'luxon';
import type { AemetRawReading } from '../client/aemetClient.js';
import { DATA_TYPES, SOURCE_FIELD, type DataType } from '../domain/dataTypes.js';
import type { MeteoStation } from '../domain/stations.js';
import {
  aggregateReadings,
  type Aggregation,
  type DatasetRow,
  type NormalizedReading,
} from './aggregationService.js';
import { toOutputIso, OUTPUT_TIMEZONE } from './timeService.js';

/** Fully validated query for the Antarctic data endpoint. */
export interface AntartidaQuery {
  readonly station: MeteoStation;
  readonly startUtc: DateTime;
  readonly endUtc: DateTime;
  readonly aggregation: Aggregation;
  /** Empty means "all data types" (challenge requirement). */
  readonly types: readonly DataType[];
}

/** The response body of the Antarctic data endpoint. */
export interface AntartidaDataset {
  readonly station: string;
  readonly stationId: string;
  /** Station name as reported by AEMET itself ("nombre" field), when available. */
  readonly sourceStationName: string | null;
  readonly start: string;
  readonly end: string;
  readonly timezone: string;
  readonly aggregation: Aggregation;
  readonly types: readonly DataType[];
  readonly count: number;
  readonly data: readonly DatasetRow[];
}

/**
 * Parses a raw AEMET value. AEMET reports numbers as strings that may use a
 * decimal comma ("2,5") and may be absent or empty; all of those become null.
 */
export function parseNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') {
      return null;
    }
    const parsed = Number(trimmed.replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * Parses the AEMET timestamp field ("fhora"), tolerating both "T"-separated
 * and space-separated ISO forms. AEMET datetimes are UTC.
 */
function parseFhora(value: unknown): DateTime | null {
  if (typeof value !== 'string' || value.trim() === '') {
    return null;
  }
  const parsed =
    DateTime.fromISO(value, { zone: 'utc' }).isValid
      ? DateTime.fromISO(value, { zone: 'utc' })
      : DateTime.fromSQL(value, { zone: 'utc' });
  return parsed.isValid ? parsed : null;
}

/** Extracts the station name ("nombre") from the first record that reports one. */
function extractStationName(raw: readonly AemetRawReading[]): string | null {
  for (const record of raw) {
    const nombre = record['nombre'];
    if (typeof nombre === 'string' && nombre.trim() !== '') {
      return nombre.trim();
    }
  }
  return null;
}

/**
 * Converts raw AEMET records into normalized readings: valid UTC instants and
 * per-type numeric values (null when missing). Records without a usable
 * timestamp are skipped. Output is sorted chronologically.
 */
export function normalizeReadings(raw: readonly AemetRawReading[]): NormalizedReading[] {
  const normalized: NormalizedReading[] = [];
  for (const record of raw) {
    const instant = parseFhora(record['fhora']);
    if (instant === null) {
      continue;
    }
    const values = {} as Record<DataType, number | null>;
    for (const type of DATA_TYPES) {
      values[type] = parseNumber(record[SOURCE_FIELD[type]]);
    }
    normalized.push({ instant, values });
  }
  normalized.sort((a, b) => a.instant.toMillis() - b.instant.toMillis());
  return normalized;
}

/** Builds the final dataset from raw AEMET records and a validated query. */
export function buildDataset(raw: readonly AemetRawReading[], query: AntartidaQuery): AntartidaDataset {
  const selectedTypes = query.types.length === 0 ? [...DATA_TYPES] : query.types;
  const normalized = normalizeReadings(raw);
  const data = aggregateReadings(normalized, query.aggregation, query.station.aggregationTimezone, selectedTypes);

  return {
    station: query.station.name,
    stationId: query.station.id,
    sourceStationName: extractStationName(raw),
    start: toOutputIso(query.startUtc),
    end: toOutputIso(query.endUtc),
    timezone: OUTPUT_TIMEZONE,
    aggregation: query.aggregation,
    types: selectedTypes,
    count: data.length,
    data,
  };
}
