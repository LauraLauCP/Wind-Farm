import { afterEach, describe, expect, it, vi } from 'vitest';
import { DateTime } from 'luxon';
import { ClimatologyClient } from '../src/client/climatologyClient.js';
import { fakeFetch } from './helpers/fakeFetch.js';
import envelope from './fixtures/aemet/climatologia_diaria_envelope.json';
import dailyData from './fixtures/aemet/climatologia_diaria_envelope_data.json';

const start = DateTime.fromISO('2026-11-01T00:00:00Z');
const end = DateTime.fromISO('2026-11-10T00:00:00Z');

const ENVELOPE_URL =
  'https://aemet.example.test/opendata/api/valores/climatologicos/diarios/datos/fechaini/' +
  '2026-11-01T00%3A00%3A00UTC/fechafin/2026-11-10T00%3A00%3A00UTC/estacion/8178D?api_key=test-api-key';
const DATA_URL = 'https://opendata.aemet.es/opendata/sh/41aaad29';

describe('ClimatologyClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('follows the two-step fetch and maps daily climatology fields to the API data types', async () => {
    const fetchMock = fakeFetch({
      [ENVELOPE_URL]: envelope,
      [DATA_URL]: dailyData,
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new ClimatologyClient('https://aemet.example.test/opendata/api', 'test-api-key');
    const records = await client.fetchDaily(start, end, '8178D');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(ENVELOPE_URL);
    expect(fetchMock.mock.calls[1]?.[0]).toBe(DATA_URL);
    expect(records).toHaveLength(10);
    // Worked example from the live fixture (comma decimals, pressure = mean of presMax/presMin).
    expect(records[0]?.date).toBe('2026-11-01');
    expect(records[0]?.temperature).toBe(14.2);
    expect(records[0]?.pressure).toBeCloseTo(942.7, 6);
    expect(records[0]?.speed).toBe(1.4);
  });

  it('splits ranges longer than 10 days into consecutive windows and merges them sorted by date', async () => {
    // One record per window, out of chronological merge order to pin the sorting.
    const windowData: Record<string, Array<Record<string, unknown>>> = {
      'https://opendata.aemet.es/opendata/sh/w1': [
        { fecha: '2026-11-05', tmed: '10,0', presMax: '1000,0', presMin: '998,0', velmedia: '2,0' },
      ],
      'https://opendata.aemet.es/opendata/sh/w2': [
        { fecha: '2026-11-15', tmed: '11,0', presMax: '1001,0', presMin: '999,0', velmedia: '2,5' },
      ],
      'https://opendata.aemet.es/opendata/sh/w3': [
        { fecha: '2026-11-23', tmed: '12,0', presMax: '1002,0', presMin: '1000,0', velmedia: '3,0' },
      ],
    };
    const fetchMock = fakeFetch({
      // Window 1: Nov 1 -> Nov 11 (10 days), window 2: Nov 11 -> Nov 21, window 3: Nov 21 -> Nov 25.
      'https://aemet.example.test/opendata/api/valores/climatologicos/diarios/datos/fechaini/2026-11-01T00%3A00%3A00UTC/fechafin/2026-11-11T00%3A00%3A00UTC/estacion/8178D?api_key=test-api-key':
        { descripcion: 'exito', estado: 200, datos: 'https://opendata.aemet.es/opendata/sh/w1' },
      'https://aemet.example.test/opendata/api/valores/climatologicos/diarios/datos/fechaini/2026-11-11T00%3A00%3A00UTC/fechafin/2026-11-21T00%3A00%3A00UTC/estacion/8178D?api_key=test-api-key':
        { descripcion: 'exito', estado: 200, datos: 'https://opendata.aemet.es/opendata/sh/w2' },
      'https://aemet.example.test/opendata/api/valores/climatologicos/diarios/datos/fechaini/2026-11-21T00%3A00%3A00UTC/fechafin/2026-11-25T00%3A00%3A00UTC/estacion/8178D?api_key=test-api-key':
        { descripcion: 'exito', estado: 200, datos: 'https://opendata.aemet.es/opendata/sh/w3' },
      ...windowData,
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new ClimatologyClient('https://aemet.example.test/opendata/api', 'test-api-key');
    const records = await client.fetchDaily(
      DateTime.fromISO('2026-11-01T00:00:00Z'),
      DateTime.fromISO('2026-11-25T00:00:00Z'),
      '8178D',
    );

    // Exactly one envelope + one data request per window (3 windows, 6 calls total).
    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(records.map((r) => r.date)).toEqual(['2026-11-05', '2026-11-15', '2026-11-23']);
  });
});
