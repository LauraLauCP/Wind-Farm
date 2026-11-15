import { useEffect, useState } from 'react';
import { fetchEstaciones } from '../api/client';
import type { PickerStation } from '../api/contract';

export interface StationsState {
  readonly stations: readonly PickerStation[];
  readonly loading: boolean;
}

const DEBOUNCE_MS = 200;

/**
 * Feeds the station picker: searches the catalog server-side, debounced,
 * aborting the previous search when the term changes.
 */
export function useStations(search: string): StationsState {
  const [state, setState] = useState<StationsState>({ stations: [], loading: false });

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setState((previous) => ({ ...previous, loading: true }));
      fetchEstaciones(search.trim(), controller.signal)
        .then((response) => {
          if (!controller.signal.aborted) {
            setState({ stations: response.stations, loading: false });
          }
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            setState({ stations: [], loading: false });
          }
        });
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [search]);

  return state;
}
