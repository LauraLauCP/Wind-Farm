/** Data types supported by the output dataset (challenge requirement). */
export const DATA_TYPES = ['temperature', 'pressure', 'speed'] as const;

export type DataType = (typeof DATA_TYPES)[number];

/** Units of each data type, as documented in the challenge requirements. */
export const DATA_TYPE_UNITS: Record<DataType, string> = {
  temperature: '°C',
  pressure: 'hPa',
  speed: 'm/s',
};

/**
 * Mapping between our public data types and the field names used by the AEMET
 * API response (challenge mapping table: temp → Temperature, pres → Pressure,
 * vel → Speed).
 */
export const SOURCE_FIELD: Record<DataType, string> = {
  temperature: 'temp',
  pressure: 'pres',
  speed: 'vel',
};

export function isDataType(value: string): value is DataType {
  return (DATA_TYPES as readonly string[]).includes(value);
}
