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
});
