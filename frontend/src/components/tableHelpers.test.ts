import { describe, expect, it } from 'vitest';
import type { DatasetRow } from '../api/contract';
import { PAGE_SIZE, paginate, sortRows } from './tableHelpers';

/** Worked example: rows in reverse datetime order, mixed granularity. */
const ROWS: readonly DatasetRow[] = [
  { datetime: '2026-11-15T13:00:00+01:00', granularity: 'observation', samples: 1, temperature: 10.5, speed: 3.2 },
  { datetime: '2026-11-02T00:00:00+01:00', granularity: 'daily', samples: null, temperature: 13.2 },
  { datetime: '2026-11-15T12:00:00+01:00', granularity: 'observation', samples: 1, temperature: 9.8, speed: 2.1 },
];

describe('sortRows', () => {
  it('sorts by a numeric column, descending', () => {
    const sorted = sortRows(ROWS, 'temperature', 'desc');
    expect(sorted.map((row) => row.temperature)).toEqual([13.2, 10.5, 9.8]);
  });

  it('places rows missing the sorted column last, regardless of direction', () => {
    const asc = sortRows(ROWS, 'speed', 'asc');
    expect(asc.map((row) => row.speed)).toEqual([2.1, 3.2, undefined]);

    const desc = sortRows(ROWS, 'speed', 'desc');
    expect(desc.map((row) => row.speed)).toEqual([3.2, 2.1, undefined]);
  });

  it('sorts the DST fall-back repeated wall-clock hour by instant, not by string', () => {
    // 02:30 Madrid happens twice on 2026-10-25: at +02:00 (00:30 UTC) first,
    // then at +01:00 (01:30 UTC). Lexicographic order would invert them.
    const dstRows: readonly DatasetRow[] = [
      { datetime: '2026-10-25T02:30:00+01:00', granularity: 'observation', samples: 1, temperature: 10.9 },
      { datetime: '2026-10-25T02:30:00+02:00', granularity: 'observation', samples: 1, temperature: 11.1 },
    ];

    const asc = sortRows(dstRows, 'datetime', 'asc');
    expect(asc.map((row) => row.temperature)).toEqual([11.1, 10.9]);
  });
});

describe('paginate', () => {
  // 60 synthetic rows: temperature = index, so slices are easy to assert.
  const sixty = Array.from({ length: 60 }, (_, index): DatasetRow => ({
    datetime: `2026-11-15T${String(Math.floor(index / 60)).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}:00+01:00`,
    granularity: 'observation',
    samples: 1,
    temperature: index,
  }));

  it('returns the 25-row page requested', () => {
    const page1 = paginate(sixty, 1);
    expect(page1.rows).toHaveLength(PAGE_SIZE);
    expect(page1.rows[0].temperature).toBe(25);
    expect(page1.page).toBe(1);
  });

  it('returns the partial last page as is', () => {
    const last = paginate(sixty, 2);
    expect(last.rows).toHaveLength(10);
    expect(last.rows[0].temperature).toBe(50);
  });

  it('clamps a page beyond the last non-empty one when the dataset shrinks', () => {
    const clamped = paginate(sixty.slice(0, 10), 5);
    expect(clamped.page).toBe(0);
    expect(clamped.rows).toHaveLength(10);
  });

  it('handles an empty dataset without leaving page 0', () => {
    expect(paginate([], 3)).toEqual({ rows: [], page: 0 });
  });
});
