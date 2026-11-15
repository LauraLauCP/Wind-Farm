import { describe, expect, it } from 'vitest';
import { ALL_DATA_TYPES } from './contract';
import { buildDatosQuery, type DatasetFilters } from './datosQuery';

describe('buildDatosQuery', () => {
  it('builds the canonical path, omitting params that match the API defaults', () => {
    const filters: DatasetFilters = {
      stationId: '89064',
      start: '2026-11-08T12:00:00',
      end: '2026-11-15T12:00:00',
      aggregation: 'none',
      types: [...ALL_DATA_TYPES],
      location: 'Europe/Madrid',
    };

    expect(buildDatosQuery(filters)).toBe(
      '/api/datos/fechaini/2026-11-08T12:00:00/fechafin/2026-11-15T12:00:00/estacion/89064' +
        '?location=Europe%2FMadrid',
    );
  });

  it('encodes a type subset and a non-default aggregation as query params', () => {
    const filters: DatasetFilters = {
      stationId: '8178D',
      start: '2026-11-01T00:00:00',
      end: '2026-11-15T12:00:00',
      aggregation: 'hourly',
      types: ['speed', 'pressure'],
      location: 'Europe/Madrid',
    };

    expect(buildDatosQuery(filters)).toBe(
      '/api/datos/fechaini/2026-11-01T00:00:00/fechafin/2026-11-15T12:00:00/estacion/8178D' +
        '?aggregation=hourly&types=speed%2Cpressure&location=Europe%2FMadrid',
    );
  });
});
