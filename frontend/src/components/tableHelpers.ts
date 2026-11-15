import type { DatasetRow } from '../api/contract';

export type SortKey = 'datetime' | 'temperature' | 'pressure' | 'speed';
export type SortDirection = 'asc' | 'desc';

/** Rows per table page (agreed design: sortable, paginated table). */
export const PAGE_SIZE = 25;

/** One page of the table, with `page` clamped to the last non-empty one. */
export function paginate(rows: readonly DatasetRow[], page: number): { rows: DatasetRow[]; page: number } {
  const lastPage = rows.length === 0 ? 0 : Math.floor((rows.length - 1) / PAGE_SIZE);
  const safePage = Math.max(0, Math.min(page, lastPage));
  return { rows: rows.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE), page: safePage };
}

/** Sorts a copy of the rows by `key`; rows missing the value go last. */
export function sortRows(rows: readonly DatasetRow[], key: SortKey, direction: SortDirection): DatasetRow[] {
  const factor = direction === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = a[key];
    const bv = b[key];
    if (av === undefined || av === null) {
      return bv === undefined || bv === null ? 0 : 1;
    }
    if (bv === undefined || bv === null) {
      return -1;
    }
    // Datetimes are compared as instants: the Madrid output includes CET/CEST
    // offsets, and the DST fall-back repeats a wall-clock hour (+02:00 then +01:00).
    if (key === 'datetime') {
      const ai = Date.parse(String(av));
      const bi = Date.parse(String(bv));
      return ai < bi ? -factor : ai > bi ? factor : 0;
    }
    return av < bv ? -factor : av > bv ? factor : 0;
  });
}
