import { useMemo, useState } from 'react';
import type { DatasetResponse, DatasetRow } from '../api/contract';
import { TYPE_META, formatDateTime, GRANULARITY_LABEL } from '../lib/display';
import { paginate, PAGE_SIZE, sortRows, type SortDirection, type SortKey } from './tableHelpers';

/**
 * The dataset as a table: sortable columns (datetime by instant, so the DST
 * fall-back hour orders correctly), 25 rows per page with the page clamped
 * when the dataset shrinks. The table is also the accessibility fallback the
 * chart palette's contrast WARN relies on.
 */
export function DatasetTable({ dataset }: { readonly dataset: DatasetResponse }) {
  const [sortKey, setSortKey] = useState<SortKey>('datetime');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [page, setPage] = useState(0);

  const sorted = useMemo(() => sortRows(dataset.data, sortKey, sortDirection), [dataset.data, sortKey, sortDirection]);
  const currentPage = useMemo(() => paginate(sorted, page), [sorted, page]);
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDirection((direction) => (direction === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDirection('asc');
    }
    setPage(0);
  };

  const headerCell = (key: SortKey, label: React.ReactNode) => {
    const isSorted = sortKey === key;
    return (
      <th key={key} aria-sort={isSorted ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}>
        <button type="button" onClick={() => toggleSort(key)} className="table-sort">
          {label}
          {isSorted && <span aria-hidden="true">{sortDirection === 'asc' ? ' ▲' : ' ▼'}</span>}
        </button>
      </th>
    );
  };

  return (
    <div className="dataset-table">
      <table>
        <thead>
          <tr>
            {headerCell('datetime', 'Datetime')}
            {dataset.types.map((type) => (
              headerCell(
                type,
                <span className="table-type">
                  <span className="table-type__dot" style={{ backgroundColor: TYPE_META[type].color }} aria-hidden="true" />
                  {TYPE_META[type].label} ({TYPE_META[type].unit})
                </span>,
              )
            ))}
            <th scope="col">Granularity</th>
            <th scope="col">Samples</th>
          </tr>
        </thead>
        <tbody>
          {currentPage.rows.map((row: DatasetRow) => {
            const datetime = formatDateTime(row.datetime);
            return (
              <tr key={row.datetime}>
                <td className="dataset-table__datetime">
                  {datetime.main} <span className="dataset-table__offset">{datetime.offset}</span>
                </td>
                {dataset.types.map((type) => (
                  <td key={type}>{row[type] ?? '—'}</td>
                ))}
                <td>{GRANULARITY_LABEL[row.granularity]}</td>
                <td>{row.samples ?? '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="dataset-table__footer">
        <span>{sorted.length} rows</span>
        <div className="dataset-table__pager">
          <button type="button" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={currentPage.page === 0}>
            ‹ Prev
          </button>
          <span>
            Page {currentPage.page + 1} / {totalPages}
          </span>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={currentPage.page >= totalPages - 1}
          >
            Next ›
          </button>
        </div>
      </div>
    </div>
  );
}
