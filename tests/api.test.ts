import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import type { AemetRawReading, AemetReadingsFetcher } from '../src/client/aemetClient.js';
import { HttpError } from '../src/domain/errors.js';

/**
 * Raw readings shaped like the real AEMET "datos" resource, deliberately
 * straddling the Madrid spring DST transition of 2026-03-29 (01:00 UTC).
 * Values use the decimal comma AEMET emits ("1,5") to exercise the parser.
 */
const rawReadings: AemetRawReading[] = [
  { nombre: 'JUAN CARLOS I', fhora: '2026-03-28T22:00:00', temp: '1,5', pres: '986', vel: '5' },
  { nombre: 'JUAN CARLOS I', fhora: '2026-03-28T22:10:00', temp: '2,5', pres: '986', vel: '6' },
  { nombre: 'JUAN CARLOS I', fhora: '2026-03-28T23:00:00', temp: '3,5', pres: '987', vel: '7' },
  { nombre: 'JUAN CARLOS I', fhora: '2026-03-28T23:10:00', temp: '4,5', pres: '987', vel: '8' },
  // After the transition: 01:00 UTC is already 03:00 CEST in Madrid.
  { nombre: 'JUAN CARLOS I', fhora: '2026-03-29T01:00:00', temp: '5,5', pres: '988', vel: '9' },
  { nombre: 'JUAN CARLOS I', fhora: '2026-03-29T01:10:00', temp: '6,5', pres: '988', vel: '10' },
];

function createFetcher(records: AemetRawReading[] = rawReadings): AemetReadingsFetcher {
  return { fetchReadings: vi.fn(async () => records) };
}

const PATH =
  '/api/antartida/datos/fechaini/2026-03-28T22:00:00/fechafin/2026-03-29T02:00:00/estacion/juan-carlos-i';

describe('GET /api/antartida/datos/...', () => {
  it('returns the full 10-minute series by default, in Europe/Madrid with offsets', async () => {
    const fetcher = createFetcher();
    const response = await request(createApp(fetcher)).get(PATH).expect(200);

    expect(response.body.station).toBe('Meteo Station Juan Carlos I');
    expect(response.body.sourceStationName).toBe('JUAN CARLOS I');
    expect(response.body.timezone).toBe('Europe/Madrid');
    expect(response.body.aggregation).toBe('none');
    expect(response.body.types).toEqual(['temperature', 'pressure', 'speed']);
    expect(response.body.count).toBe(6);
    expect(response.body.data).toHaveLength(6);

    const first = response.body.data[0];
    // 22:00 UTC on the 28th is 23:00 CET (+01:00).
    expect(first).toEqual({
      datetime: '2026-03-28T23:00:00+01:00',
      samples: 1,
      temperature: 1.5,
      pressure: 986,
      speed: 5,
    });

    // The fetcher must be called with the station's AEMET id and UTC instants.
    expect(fetcher.fetchReadings).toHaveBeenCalledTimes(1);
    const [startUtc, endUtc, aemetId] = (fetcher.fetchReadings as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(startUtc.toISO()).toBe('2026-03-28T22:00:00.000Z');
    expect(endUtc.toISO()).toBe('2026-03-29T02:00:00.000Z');
    expect(aemetId).toBe('89064');
  });

  it('shows the DST spring-forward in the output datetimes', async () => {
    const response = await request(createApp(createFetcher())).get(PATH).expect(200);
    const datetimes: string[] = response.body.data.map((row: { datetime: string }) => row.datetime);
    expect(datetimes[3]).toBe('2026-03-29T00:10:00+01:00'); // last CET row
    expect(datetimes[4]).toBe('2026-03-29T03:00:00+02:00'); // first CEST row: 02:00–03:00 does not exist
  });

  it('filters the output to the requested data types', async () => {
    const response = await request(createApp(createFetcher()))
      .get(`${PATH}?types=temperature,speed`)
      .expect(200);

    expect(response.body.types).toEqual(['temperature', 'speed']);
    expect(Object.keys(response.body.data[0]).sort()).toEqual([
      'datetime',
      'samples',
      'speed',
      'temperature',
    ]);
  });

  it('returns all data types when types is present but empty', async () => {
    const response = await request(createApp(createFetcher())).get(`${PATH}?types=`).expect(200);
    expect(response.body.types).toEqual(['temperature', 'pressure', 'speed']);
  });

  it('aggregates hourly: one row per hour with the mean of valid samples', async () => {
    const response = await request(createApp(createFetcher()))
      .get(`${PATH}?aggregation=hourly`)
      .expect(200);

    expect(response.body.aggregation).toBe('hourly');
    expect(response.body.count).toBe(3);

    const firstHour = response.body.data[0];
    expect(firstHour).toEqual({
      datetime: '2026-03-28T23:00:00+01:00',
      samples: 2,
      temperature: 2,
      pressure: 986,
      speed: 5.5,
    });
  });

  it('aggregates daily with day boundaries drawn in the station timezone', async () => {
    const response = await request(createApp(createFetcher()))
      .get(`${PATH}?aggregation=daily`)
      .expect(200);

    expect(response.body.count).toBe(2);
    const [firstDay, secondDay] = response.body.data;
    expect(firstDay.samples).toBe(4);
    expect(firstDay.temperature).toBe(3);
    expect(secondDay.samples).toBe(2);
    expect(secondDay.temperature).toBe(6);
    // Day boundaries are midnight UTC (the stations' data timezone), rendered in Madrid.
    expect(firstDay.datetime).toBe('2026-03-28T01:00:00+01:00');
    expect(secondDay.datetime).toBe('2026-03-29T01:00:00+01:00');
  });

  it('interprets input datetimes in the location given by the user', async () => {
    const fetcher = createFetcher();
    await request(createApp(fetcher))
      .get(`${PATH}?location=Europe/Madrid`)
      .expect(200);

    const [startUtc, endUtc] = (fetcher.fetchReadings as ReturnType<typeof vi.fn>).mock.calls[0];
    // Wall times were Madrid CET (+01:00) on those dates → one hour earlier in UTC.
    expect(startUtc.toISO()).toBe('2026-03-28T21:00:00.000Z');
    expect(endUtc.toISO()).toBe('2026-03-29T01:00:00.000Z');
  });

  it('also accepts a fixed UTC offset as location', async () => {
    const fetcher = createFetcher();
    await request(createApp(fetcher))
      .get(`${PATH}?location=-03:00`)
      .expect(200);

    const [startUtc] = (fetcher.fetchReadings as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(startUtc.toISO()).toBe('2026-03-29T01:00:00.000Z');
  });

  it('rejects an unknown station with the list of valid ones', async () => {
    const response = await request(createApp(createFetcher()))
      .get('/api/antartida/datos/fechaini/2026-03-28T00:00:00/fechafin/2026-03-29T00:00:00/estacion/somewhere-else')
      .expect(400);

    expect(response.body.error.code).toBe('bad_request');
    expect(response.body.error.message).toMatch(/juan-carlos-i/);
    expect(response.body.error.message).toMatch(/gabriel-de-castilla/);
  });

  it('rejects malformed datetimes', async () => {
    await request(createApp(createFetcher()))
      .get('/api/antartida/datos/fechaini/2026-03-28/fechafin/2026-03-29T00:00:00/estacion/juan-carlos-i')
      .expect(400);
  });

  it('rejects an invalid location', async () => {
    await request(createApp(createFetcher()))
      .get(`${PATH}?location=MiddleEarth/Rivendell`)
      .expect(400);
  });

  it('rejects an invalid aggregation and invalid data types', async () => {
    await request(createApp(createFetcher())).get(`${PATH}?aggregation=yearly`).expect(400);
    await request(createApp(createFetcher())).get(`${PATH}?types=temperature,humidity`).expect(400);
  });

  it('rejects a start datetime that is not before the end datetime', async () => {
    await request(createApp(createFetcher()))
      .get(
        '/api/antartida/datos/fechaini/2026-03-29T00:00:00/fechafin/2026-03-28T00:00:00/estacion/juan-carlos-i',
      )
      .expect(400);
  });

  it('maps an upstream AEMET "no data" failure to a clean 404', async () => {
    const fetcher: AemetReadingsFetcher = {
      fetchReadings: vi.fn(async () => {
        throw new HttpError(404, 'no_data', 'AEMET has no data for the requested station and time range.');
      }),
    };
    const response = await request(createApp(fetcher)).get(PATH).expect(404);
    expect(response.body.error.code).toBe('no_data');
  });

  it('returns an empty dataset when AEMET reports no readings', async () => {
    const response = await request(createApp(createFetcher([]))).get(PATH).expect(200);
    expect(response.body.count).toBe(0);
    expect(response.body.data).toEqual([]);
  });

  it('answers 404 with a JSON body for unknown routes', async () => {
    const response = await request(createApp(createFetcher())).get('/api/nope').expect(404);
    expect(response.body.error.code).toBe('not_found');
  });
});
