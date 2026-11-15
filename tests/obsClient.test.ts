import { afterEach, describe, expect, it, vi } from 'vitest';
import { DateTime } from 'luxon';
import { ConventionalObsClient } from '../src/client/obsClient.js';
import { fakeFetch } from './helpers/fakeFetch.js';
import envelope from './fixtures/aemet/convencional_obs_envelope.json';
import obsData from './fixtures/aemet/convencional_obs_envelope_data.json';

const ENVELOPE_URL =
  'https://aemet.example.test/opendata/api/observacion/convencional/datos/estacion/8178D?api_key=test-api-key';
const DATA_URL = 'https://opendata.aemet.es/opendata/sh/55328a1e';

describe('ConventionalObsClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('follows the two-step fetch and maps observation fields (ta/pres/vv) to our data types', async () => {
    const fetchMock = fakeFetch({
      [ENVELOPE_URL]: envelope,
      [DATA_URL]: obsData,
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new ConventionalObsClient('https://aemet.example.test/opendata/api', 'test-api-key');
    const readings = await client.fetchObservations('8178D');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(ENVELOPE_URL);
    expect(fetchMock.mock.calls[1]?.[0]).toBe(DATA_URL);
    expect(readings).toHaveLength(13);

    // Worked example from the live fixture: fint "2026-11-15T01:00:00+0000" (no "Z"),
    // ta 10.0, pres 943.1, vv 0.8.
    const first = readings[0];
    expect(first?.instant.toISO()).toBe('2026-11-15T01:00:00.000Z');
    expect(first?.temperature).toBe(10.0);
    expect(first?.pressure).toBe(943.1);
    expect(first?.speed).toBe(0.8);

    // The series comes back chronologically ordered.
    for (let i = 1; i < readings.length; i++) {
      expect(readings[i]!.instant > readings[i - 1]!.instant).toBe(true);
    }
  });
});
