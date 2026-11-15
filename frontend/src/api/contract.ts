/**
 * Mirror of the backend API contract (src/services/aggregationService.ts,
 * src/domain/dataTypes.ts). Kept local — not imported across projects — so
 * the front-end toolchain stays independent; when the contract changes on
 * either side, this file is the single place to reconcile.
 */

/** Time aggregation of the output dataset (backend AGGREGATIONS). */
export const AGGREGATIONS = ['none', 'hourly', 'daily', 'monthly'] as const;
export type Aggregation = (typeof AGGREGATIONS)[number];

/** The three meteo measurements the API serves (backend DATA_TYPES). */
export const DATA_TYPES = ['temperature', 'pressure', 'speed'] as const;
export type DataType = (typeof DATA_TYPES)[number];

/** All types — when the user wants everything, the API omits the param. */
export const ALL_DATA_TYPES: readonly DataType[] = DATA_TYPES;

/** One row of the dataset (backend StationDatasetRow). */
export type DatasetRow = {
  readonly datetime: string;
  readonly granularity: 'observation' | 'daily';
  readonly samples: number | null;
} & Partial<Record<DataType, number | null>>;

/** Response of GET /api/datos/... (backend datosRoute). */
export interface DatasetResponse {
  readonly station: string;
  readonly stationId: string;
  readonly start: string;
  readonly end: string;
  readonly timezone: string;
  readonly aggregation: Aggregation;
  readonly types: DataType[];
  readonly count: number;
  readonly data: readonly DatasetRow[];
  readonly stale: boolean;
  readonly partial: boolean;
  readonly lastSyncedAt: string | null;
}

/** One entry of GET /api/estaciones (backend PickerStation). */
export interface PickerStation {
  readonly id: string;
  readonly name: string;
  readonly province: string | null;
  readonly latitude: number | null;
  readonly longitude: number | null;
}

/** Response of GET /api/estaciones. */
export interface EstacionesResponse {
  readonly count: number;
  readonly stations: readonly PickerStation[];
}
