import type { DataType, DatasetRow } from '../api/contract';

/**
 * Display metadata per data type. The series colors are the validated steps
 * of the brand palette (dataviz six-checks, light surface): temperature =
 * brand petrol nudged to pass the chroma floor, pressure = brand cyan family,
 * speed = brand green. Colors follow the entity, never their rank.
 */
export const TYPE_META: Record<DataType, { label: string; unit: string; color: string }> = {
  temperature: { label: 'Temperature', unit: '°C', color: '#055C8A' },
  pressure: { label: 'Pressure', unit: 'hPa', color: '#1AA9C9' },
  speed: { label: 'Wind speed', unit: 'm/s', color: '#5D8A40' },
};

/** Granularity label of a row (backend honesty labels). */
export const GRANULARITY_LABEL: Record<DatasetRow['granularity'], string> = {
  observation: '10 min',
  daily: 'daily',
};

/** Aggregations shown in the form, in the challenge's order. */
export const AGGREGATION_LABEL: Record<string, string> = {
  none: 'None (native)',
  hourly: 'Hourly',
  daily: 'Daily',
  monthly: 'Monthly',
};

/** '2026-11-15T12:00:00+01:00' → '15/11 13:00' (chart ticks). */
export function formatTick(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)} ${iso.slice(11, 16)}`;
}

/** '2026-11-15T12:00:00+01:00' → main '2026-11-15 12:00', offset '+01:00'. */
export function formatDateTime(iso: string): { main: string; offset: string } {
  return { main: iso.slice(0, 16).replace('T', ' '), offset: iso.slice(19) };
}
