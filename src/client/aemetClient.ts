import { DateTime } from 'luxon';
import { env } from '../config/env.js';
import { HttpError } from '../domain/errors.js';

/**
 * One raw record as returned by the AEMET "datos" resource.
 * AEMET uses string values that may be empty, and decimal commas ("2,5"),
 * so every field is treated as unknown until normalized.
 */
export interface AemetRawReading {
  [field: string]: unknown;
}

/**
 * Contract the rest of the application depends on. Keeping this interface
 * separate from the implementation makes the AEMET client trivially
 * replaceable in tests (and, later, by a caching layer — see Part 2).
 */
export interface AemetReadingsFetcher {
  fetchReadings(startUtc: DateTime, endUtc: DateTime, aemetStationId: string): Promise<AemetRawReading[]>;
}

/** Envelope returned by every AEMET OpenData endpoint (HATEOAS-style, two-step fetch). */
interface AemetEnvelope {
  descripcion?: string;
  estado?: number;
  datos?: string;
}

/**
 * Formats a UTC instant the way the AEMET antartida endpoint expects:
 * `AAAA-MM-DDTHH:MM:SSUTC` (the "UTC" suffix is part of AEMET's format).
 */
function formatAemetInstant(instant: DateTime): string {
  return instant.toUTC().toFormat("yyyy-MM-dd'T'HH:mm:ss'UTC'");
}

/** Translates AEMET HTTP failures into typed application errors. */
function upstreamError(status: number): HttpError {
  switch (status) {
    case 401:
      return new HttpError(
        502,
        'aemet_invalid_api_key',
        'AEMET rejected the configured API key. Review AEMET_API_KEY in your .env file.',
      );
    case 404:
      return new HttpError(404, 'no_data', 'AEMET has no data for the requested station and time range.');
    case 429:
      return new HttpError(429, 'aemet_rate_limited', 'The AEMET OpenData API rate limit was exceeded. Please retry later.');
    default:
      return new HttpError(
        502,
        'aemet_upstream_error',
        `Unexpected response from the AEMET API (HTTP ${status}).`,
      );
  }
}

export class AemetClient implements AemetReadingsFetcher {
  constructor(
    private readonly baseUrl: string = env.AEMET_BASE_URL,
    private readonly apiKey: string = env.AEMET_API_KEY,
  ) {}

  /**
   * Retrieves the raw readings of a station between two UTC instants.
   *
   * AEMET works in two steps: the first request returns an envelope whose
   * `datos` field is a URL pointing at the actual data resource; a second
   * GET on that URL returns the readings.
   */
  async fetchReadings(
    startUtc: DateTime,
    endUtc: DateTime,
    aemetStationId: string,
  ): Promise<AemetRawReading[]> {
    const url =
      `${this.baseUrl}/antartida/datos/fechaini/${formatAemetInstant(startUtc)}` +
      `/fechafin/${formatAemetInstant(endUtc)}` +
      `/estacion/${encodeURIComponent(aemetStationId)}` +
      `?api_key=${encodeURIComponent(this.apiKey)}`;

    const envelope = await this.getJson<AemetEnvelope>(url);

    if (envelope.estado !== 200 || typeof envelope.datos !== 'string') {
      // AEMET reports "no data" as HTTP 200 + estado 404 in the envelope.
      if (envelope.estado === 404) {
        throw new HttpError(404, 'no_data', 'AEMET has no data for the requested station and time range.');
      }
      throw new HttpError(
        502,
        'aemet_upstream_error',
        `AEMET responded with estado ${String(envelope.estado)}: ${String(envelope.descripcion)}`,
      );
    }

    const data = await this.getJson<AemetRawReading[]>(envelope.datos);
    return Array.isArray(data) ? data : [];
  }

  /** GETs an AEMET JSON resource, translating transport failures into typed errors. */
  private async getJson<T>(url: string): Promise<T> {
    let response: Response;
    try {
      response = await fetch(url, { headers: { Accept: 'application/json' } });
    } catch {
      throw new HttpError(503, 'aemet_unreachable', 'Could not reach the AEMET OpenData API.');
    }
    if (!response.ok) {
      throw upstreamError(response.status);
    }
    return (await response.json()) as T;
  }
}
