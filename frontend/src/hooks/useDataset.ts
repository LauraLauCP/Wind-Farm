import { useCallback, useEffect, useState } from 'react';
import { fetchDataset } from '../api/client';
import type { DatasetResponse } from '../api/contract';

export type DatasetStatus = 'idle' | 'loading' | 'success' | 'error';

export interface DatasetState {
  readonly status: DatasetStatus;
  readonly data: DatasetResponse | null;
  readonly error: string | null;
  /** Re-runs the last request (e.g. after an upstream hiccup). */
  readonly reload: () => void;
}

/**
 * Fetches the dataset for `url`, aborting any in-flight request when the URL
 * changes. `null` keeps the hook idle — the form hasn't been submitted yet.
 */
export function useDataset(url: string | null): DatasetState {
  const [state, setState] = useState<Omit<DatasetState, 'reload'>>({
    status: 'idle',
    data: null,
    error: null,
  });
  const [reloadCount, setReloadCount] = useState(0);

  useEffect(() => {
    if (url === null) {
      setState({ status: 'idle', data: null, error: null });
      return;
    }

    const controller = new AbortController();
    setState({ status: 'loading', data: null, error: null });

    fetchDataset(url, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) {
          setState({ status: 'success', data, error: null });
        }
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return; // superseded by a newer request
        }
        setState({
          status: 'error',
          data: null,
          error: error instanceof Error ? error.message : 'Unexpected error.',
        });
      });

    return () => controller.abort();
  }, [url, reloadCount]);

  const reload = useCallback(() => setReloadCount((count) => count + 1), []);
  return { ...state, reload };
}
