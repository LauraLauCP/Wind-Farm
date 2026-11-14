import { afterEach, describe, expect, it, vi } from 'vitest';
import { DateTime } from 'luxon';
import { AemetClient } from '../src/client/aemetClient.js';
import { HttpError } from '../src/domain/errors.js';

// The AEMET client is the only piece that talks HTTP for real — these tests
// pin the quirks of the live API (verified against opendata.aemet.es):
//   1. dates in the path carry the literal "UTC" suffix,
//   2. every call returns an envelope whose "datos" field is a second URL,
//   3. "no data" comes as HTTP 200 + estado 404 inside the envelope.

function fakeFetch(responses: Record<string, unknown>): ReturnType<typeof vi.fn> {
  return vi.fn(async (url: unknown) => {
    const key = String(url);
    const body = responses[key];
    if (body === undefined) {
      return new Response('{"descripcion":"not stubbed"}', { status: 500 });
    }
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
}

const start = DateTime.fromISO('2026-01-01T00:00:00Z');
const end = DateTime.fromISO('2026-01-02T00:00:00Z');

const ENVELOPE_URL =
  'https://aemet.example.test/opendata/api/antartida/datos/fechaini/2026-01-01T00:00:00UTC/fechafin/2026-01-02T00:00:00UTC/estacion/89064?api_key=test-api-key';
const DATA_URL = 'https://opendata.aemet.es/opendata/sh/datos_20260101_json';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AemetClient', () => {
  it('builds the AEMET URL with the "UTC" suffix and follows the two-step fetch', async () => {
    const fetchMock = fakeFetch({
      [ENVELOPE_URL]: { descripcion: 'exito', estado: 200, datos: DATA_URL },
      [DATA_URL]: [{ fhora: '2026-01-01T00:00:00Z', temp: 1.1, pres: 993.0, vel: 3.6 }],
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new AemetClient();
    const readings = await client.fetchReadings(start, end, '89064');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(ENVELOPE_URL);
    expect(fetchMock.mock.calls[1]?.[0]).toBe(DATA_URL);
    expect(readings).toEqual([{ fhora: '2026-01-01T00:00:00Z', temp: 1.1, pres: 993.0, vel: 3.6 }]);
  });

  it('maps the envelope "estado 404" (no data) to a clean 404', async () => {
    vi.stubGlobal(
      'fetch',
      fakeFetch({
        [ENVELOPE_URL]: { descripcion: 'No hay datos que satisfagan esos criterios', estado: 404 },
      }),
    );

    const client = new AemetClient();
    await expect(client.fetchReadings(start, end, '89064')).rejects.toMatchObject({
      status: 404,
      code: 'no_data',
    });
  });

  it('maps an envelope-level error to a 502 with the AEMET description', async () => {
    vi.stubGlobal(
      'fetch',
      fakeFetch({
        [ENVELOPE_URL]: { descripcion: 'El campo fecha final inicial tener formato', estado: 400 },
      }),
    );

    const client = new AemetClient();
    await expect(client.fetchReadings(start, end, '89064')).rejects.toMatchObject({
      status: 502,
      code: 'aemet_upstream_error',
    });
  });

  it('maps an HTTP 401 from AEMET to a 502 with a helpful message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"descripcion":"JWT signature does not match"}', { status: 401 })),
    );

    const client = new AemetClient();
    await expect(client.fetchReadings(start, end, '89064')).rejects.toMatchObject({
      status: 502,
      code: 'aemet_invalid_api_key',
    });
  });

  it('maps a network failure to a 503', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed');
      }),
    );

    const client = new AemetClient();
    await expect(client.fetchReadings(start, end, '89064')).rejects.toMatchObject({
      status: 503,
      code: 'aemet_unreachable',
    });
  });
});
