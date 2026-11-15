import { DateTime } from 'luxon';
import { env } from '../config/env.js';
import { HttpError } from '../domain/errors.js';
import { parseNumber } from '../services/antartidaService.js';

/**
 * One instantaneous (10-min to hourly, station-dependent) observation.
 * The timestamp is a real instant in UTC, so unlike the daily climatology
 * record it is normalized here.
 */
export interface ObsReading {
  /** Observation time ("fint"), UTC. */
  readonly instant: DateTime;
  /** Ambient temperature (°C), from "ta". */
  readonly temperature: number | null;
  /** Station-level pressure (hPa), from "pres". */
  readonly pressure: number | null;
  /** Wind speed (m/s), from "vv". */
  readonly speed: number | null;
}

/** Envelope returned by every AEMET OpenData endpoint (two-step fetch). */
interface AemetEnvelope {
  descripcion?: unknown;
  estado?: unknown;
  datos?: unknown;
}

type AemetRawRecord = Record<string, unknown>;

/**
 * Parses the "fint" timestamp. AEMET conventional observations use an
 * ISO form with a "+0000" offset and no "Z" (verified quirk).
 */
function parseFint(value: unknown): DateTime | null {
  if (typeof value !== 'string' || value.trim() === '') {
    return null;
  }
  const parsed = DateTime.fromISO(value, { zone: 'utc' });
  return parsed.isValid ? parsed : null;
}

/** Maps one raw observation record to our data types; records without a usable timestamp are skipped. */
function toObsReading(record: AemetRawRecord): ObsReading | null {
  const instant = parseFint(record['fint']);
  if (instant === null) {
    return null;
  }
  return {
    instant,
    temperature: parseNumber(record['ta']),
    pressure: parseNumber(record['pres']),
    speed: parseNumber(record['vv']),
  };
}

export class ConventionalObsClient {
  constructor(
    private readonly baseUrl: string = env.AEMET_BASE_URL,
    private readonly apiKey: string = env.AEMET_API_KEY,
  ) {}

  /**
   * Retrieves the most recent observations of a station (upstream keeps
   * roughly the last 24 hours; the cadence is station-dependent, often
   * hourly). Two-step fetch as pinned by the live fixture of station 8178D.
   */
  async fetchObservations(idema: string): Promise<ObsReading[]> {
    const url =
      `${this.baseUrl}/observacion/convencional/datos/estacion/${encodeURIComponent(idema)}` +
      `?api_key=${encodeURIComponent(this.apiKey)}`;

    const envelope = await this.getJson<AemetEnvelope>(url);
    if (envelope.estado !== 200 || typeof envelope.datos !== 'string') {
      // AEMET reports "no data" as HTTP 200 + estado 404 in the envelope (verified quirk).
      if (envelope.estado === 404) {
        throw new HttpError(404, 'no_data', 'AEMET has no observations for the requested station.');
      }
      throw new HttpError(
        502,
        'aemet_upstream_error',
        `AEMET responded with estado ${String(envelope.estado)}: ${String(envelope.descripcion)}`,
      );
    }

    const data = await this.getJson<AemetRawRecord[]>(envelope.datos);
    const readings = (Array.isArray(data) ? data : [])
      .map(toObsReading)
      .filter((reading): reading is ObsReading => reading !== null);
    readings.sort((a, b) => a.instant.toMillis() - b.instant.toMillis());
    return readings;
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
      switch (response.status) {
        case 401:
          throw new HttpError(502, 'aemet_invalid_api_key', 'AEMET rejected the configured API key.');
        case 429:
          throw new HttpError(429, 'aemet_rate_limited', 'The AEMET OpenData API rate limit was exceeded.');
        default:
          throw new HttpError(502, 'aemet_upstream_error', `Unexpected response from the AEMET API (HTTP ${response.status}).`);
      }
    }
    return (await response.json()) as T;
  }
}
