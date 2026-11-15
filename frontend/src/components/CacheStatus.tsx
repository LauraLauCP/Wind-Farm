import type { DatasetResponse } from '../api/contract';
import { formatDateTime } from '../lib/display';

/**
 * The honesty bar: cache metadata the API reports (stale / partial /
 * lastSyncedAt) plus the mix of granularities in the current dataset.
 * Status is never color-alone — every chip carries its label.
 */
export function CacheStatus({ dataset }: { readonly dataset: DatasetResponse }) {
  const hasObservations = dataset.data.some((row) => row.granularity === 'observation');
  const hasDaily = dataset.data.some((row) => row.granularity === 'daily');
  const synced = dataset.lastSyncedAt === null ? null : formatDateTime(dataset.lastSyncedAt);

  return (
    <div className="cache-status">
      <div className="cache-status__meta">
        <strong>{dataset.station}</strong>
        <span className="cache-status__meta-detail">
          {dataset.stationId} · {dataset.aggregation} aggregation · {dataset.timezone}
        </span>
      </div>

      <div className="cache-status__chips">
        {dataset.stale && (
          <span className="chip chip--warning" title="The source API failed and this is a cached copy.">
            ⚠ Stale — cached copy
          </span>
        )}
        {dataset.partial && (
          <span className="chip chip--warning" title="Some of the requested range could not be filled.">
            ⚠ Partial data
          </span>
        )}
        {!dataset.stale && !dataset.partial && dataset.count > 0 && (
          <span className="chip chip--ok" title="The dataset was assembled from the source API.">
            ✓ Fresh
          </span>
        )}
        {hasObservations && hasDaily && (
          <span className="chip">10-min observations + daily climatology</span>
        )}
        {hasObservations && !hasDaily && <span className="chip">10-min observations</span>}
        {hasDaily && !hasObservations && <span className="chip">daily climatology</span>}
        <span className="cache-status__synced">
          {synced === null ? 'never synced' : `last synced ${synced.main} (${synced.offset})`}
        </span>
      </div>
    </div>
  );
}
