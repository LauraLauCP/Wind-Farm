export interface MeteoStation {
  /** Stable slug exposed by our API (the {identificacion} path segment). */
  readonly id: string;
  /** Display name, as specified in the challenge requirements. */
  readonly name: string;
  /** Station identifier ("identificacion") expected by the AEMET OpenData API. */
  readonly aemetId: string;
  /**
   * IANA time zone used to draw the hour/day/month boundaries when aggregating.
   * AEMET publishes the Antarctic stations' data in UTC, so day and month
   * buckets are computed in UTC (this is what the challenge calls "considering
   * the time zone location of the meteo station"). Keep it per-station so it
   * stays explicit and configurable.
   */
  readonly aggregationTimezone: string;
}

/**
 * Catalog of the meteo stations available through this API. Only the two
 * Spanish Antarctic stations named by the challenge are selectable.
 *
 * AEMET identifiers taken from the official OpenData catalog
 * (https://opendata.aemet.es/centrodedescargas — product "antartida").
 */
export const STATIONS: readonly MeteoStation[] = [
  {
    id: 'juan-carlos-i',
    name: 'Meteo Station Juan Carlos I',
    aemetId: '89064',
    aggregationTimezone: 'UTC',
  },
  {
    id: 'gabriel-de-castilla',
    name: 'Meteo Station Gabriel de Castilla',
    aemetId: '89070',
    aggregationTimezone: 'UTC',
  },
];

export function findStation(id: string): MeteoStation | undefined {
  const normalized = id.trim().toLowerCase();
  return STATIONS.find((station) => station.id === normalized);
}

export function validStationIds(): string[] {
  return STATIONS.map((station) => station.id);
}
