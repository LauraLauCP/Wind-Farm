import { ALL_DATA_TYPES, type Aggregation, type DataType } from './contract';

/**
 * The query form state, encoded into a GET /api/datos/... request.
 * `start`/`end` are wall times in the `location` zone (YYYY-MM-DDTHH:MM:SS).
 */
export interface DatasetFilters {
  readonly stationId: string;
  readonly start: string;
  readonly end: string;
  readonly aggregation: Aggregation;
  readonly types: readonly DataType[];
  readonly location: string;
}

/**
 * Encodes the form state into the canonical GET /api/datos URL.
 * Params that match the API defaults (aggregation none, all types,
 * empty location) are omitted so the request reads like the challenge spec.
 */
export function buildDatosQuery(filters: DatasetFilters): string {
  const path =
    `/api/datos/fechaini/${filters.start}` +
    `/fechafin/${filters.end}/estacion/${encodeURIComponent(filters.stationId)}`;

  const params = new URLSearchParams();
  if (filters.aggregation !== 'none') {
    params.set('aggregation', filters.aggregation);
  }
  if (filters.types.length !== ALL_DATA_TYPES.length) {
    params.set('types', filters.types.join(','));
  }
  if (filters.location !== '') {
    params.set('location', filters.location);
  }

  const queryString = params.toString();
  return queryString === '' ? path : `${path}?${queryString}`;
}
