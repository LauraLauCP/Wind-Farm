import { describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import {
  aggregateReadings,
  type NormalizedReading,
} from '../src/services/aggregationService.js';

function reading(
  isoUtc: string,
  values: { temperature?: number | null; pressure?: number | null; speed?: number | null },
): NormalizedReading {
  return {
    instant: DateTime.fromISO(isoUtc, { zone: 'utc' }),
    values: {
      temperature: values.temperature ?? null,
      pressure: values.pressure ?? null,
      speed: values.speed ?? null,
    },
  };
}

const STATION_TZ = 'UTC';

// Six 10-minute readings in the same UTC hour, with some missing values.
const oneHour: NormalizedReading[] = [
  reading('2026-10-01T10:00:00Z', { temperature: 10, pressure: 1000, speed: 5 }),
  reading('2026-10-01T10:10:00Z', { temperature: 12, pressure: 1004, speed: 7 }),
  reading('2026-10-01T10:20:00Z', { temperature: null, pressure: 1002, speed: 4 }),
  reading('2026-10-01T10:30:00Z', { temperature: 14, pressure: null, speed: 6 }),
  reading('2026-10-01T10:40:00Z', { temperature: 16, pressure: 1006, speed: 8 }),
  reading('2026-10-01T10:50:00Z', { temperature: 18, pressure: 1008, speed: 10 }),
];

describe('aggregateReadings — none', () => {
  it('returns every reading as-is with samples = 1', () => {
    const rows = aggregateReadings(oneHour, 'none', STATION_TZ, ['temperature', 'pressure', 'speed']);
    expect(rows).toHaveLength(6);
    for (const row of rows) {
      expect(row.samples).toBe(1);
    }
    expect(rows[0]).toEqual({
      datetime: '2026-10-01T12:00:00+02:00',
      samples: 1,
      temperature: 10,
      pressure: 1000,
      speed: 5,
    });
  });

  it('keeps null values when the source did not report them', () => {
    const rows = aggregateReadings(oneHour, 'none', STATION_TZ, ['temperature']);
    expect(rows[2]?.temperature).toBeNull();
  });
});

describe('aggregateReadings — hourly', () => {
  it('averages the valid samples of the hour, skipping missing values', () => {
    const rows = aggregateReadings(oneHour, 'hourly', STATION_TZ, ['temperature', 'pressure', 'speed']);
    expect(rows).toHaveLength(1);

    const row = rows[0]!;
    expect(row.samples).toBe(6);
    // temperature: (10 + 12 + 14 + 16 + 18) / 5 — the null is skipped, not zero.
    expect(row.temperature).toBe(14);
    // pressure: (1000 + 1004 + 1002 + 1006 + 1008) / 5.
    expect(row.pressure).toBe(1004);
    // speed: (5 + 7 + 4 + 6 + 8 + 10) / 6.
    expect(row.speed).toBe(6.67);
    // Bucket start 10:00 UTC → Madrid 12:00 CEST (+02:00).
    expect(row.datetime).toBe('2026-10-01T12:00:00+02:00');
  });

  it('reports null when no sample of a type exists in the bucket', () => {
    const readings = [
      reading('2026-10-01T10:00:00Z', { pressure: 1000 }),
      reading('2026-10-01T10:10:00Z', { pressure: 1002 }),
    ];
    const rows = aggregateReadings(readings, 'hourly', STATION_TZ, ['temperature', 'pressure']);
    expect(rows[0]?.temperature).toBeNull();
    expect(rows[0]?.pressure).toBe(1001);
  });
});

describe('aggregateReadings — daily', () => {
  it('draws day boundaries in the station time zone', () => {
    const readings = [
      reading('2026-10-01T23:50:00Z', { temperature: 1 }),
      reading('2026-10-02T00:10:00Z', { temperature: 3 }),
    ];
    const rows = aggregateReadings(readings, 'daily', 'UTC', ['temperature']);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.samples).toBe(1);
    expect(rows[0]?.temperature).toBe(1);
    expect(rows[1]?.temperature).toBe(3);
    // Bucket starts are midnight UTC, rendered in Madrid time (CEST in October 1st/2nd).
    expect(rows[0]?.datetime).toBe('2026-10-01T02:00:00+02:00');
    expect(rows[1]?.datetime).toBe('2026-10-02T02:00:00+02:00');
  });

  it('returns buckets in chronological order even for unsorted input', () => {
    const readings = [
      reading('2026-10-02T00:10:00Z', { temperature: 3 }),
      reading('2026-10-01T23:50:00Z', { temperature: 1 }),
    ];
    const rows = aggregateReadings(readings, 'daily', 'UTC', ['temperature']);
    expect(rows.map((row) => row.datetime)).toEqual([
      '2026-10-01T02:00:00+02:00',
      '2026-10-02T02:00:00+02:00',
    ]);
  });
});

describe('aggregateReadings — monthly', () => {
  it('groups readings by calendar month of the station time zone', () => {
    const readings = [
      reading('2026-03-31T23:50:00Z', { temperature: -10 }),
      reading('2026-04-01T00:10:00Z', { temperature: -2 }),
    ];
    const rows = aggregateReadings(readings, 'monthly', 'UTC', ['temperature']);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.temperature).toBe(-10);
    expect(rows[1]?.temperature).toBe(-2);
    expect(rows[0]?.datetime).toBe('2026-03-01T01:00:00+01:00');
    expect(rows[1]?.datetime).toBe('2026-04-01T02:00:00+02:00');
  });
});

describe('aggregateReadings — selected types', () => {
  it('only includes the requested data types as row keys', () => {
    const rows = aggregateReadings(oneHour, 'hourly', STATION_TZ, ['temperature', 'speed']);
    expect(Object.keys(rows[0]!).sort()).toEqual(['datetime', 'samples', 'speed', 'temperature']);
  });
});
