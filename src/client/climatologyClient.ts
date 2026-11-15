import { DateTime } from 'luxon';
import { env } from '../config/env.js';
import { HttpError } from '../domain/errors.js';
import { splitIntoWindows } from '../domain/timeWindows.js';
import { parseNumber } from '../services/antartidaService.js';

/** One day of daily climatology, already mapped to the API's data types. */
export interface DailyClimatologyRecord {
  /** Calendar day as reported by AEMET ("YYYY-MM-DD"). */
  readonly date: string;
  /** Daily mean temperature (°C), from "tmed". */
  readonly temperature: number | null;
  /** Mean sea-level pressure of presMax/presMin (hPa). */
  readonly pressure: number | null;
  /** Daily mean wind speed (m/s), from "velmedia". */
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
 * AEMET serves daily climatology with a practical ~10-day cap per request,
 * so a range is split into consecutive windows of at most 10 days.
 */
const MAX_WINDOW_DAYS = 10;

/** Maps one raw climatology record to our daily data types. */
function toDailyRecord(record: AemetRawRecord): DailyClimatologyRecord {
  const presMax = parseNumber(record['presMax']);
  const presMin = parseNumber(record['presMin']);
  const date = typeof record['fecha'] === 'string' ? record['fecha'].trim() : '';
  return {
    date,
    temperature: parseNumber(record['tmed']),
    pressure: presMax !== null && presMin !== null ? (presMax + presMin) / 2 : null,
    speed: parseNumber(record['velmedia']),
  };
}

export class ClimatologyClient {
  constructor(
    private readonly baseUrl: string = env.AEMET_BASE_URL,
    private readonly apiKey: string = env.AEMET_API_KEY,
  ) {}

  /**
   * Retrieves the daily climatology of one station between two UTC instants.
   *
   * AEMET works in two steps (envelope → "datos" URL), as pinned by the live
   * fixture captured from station 8178D. Dates are percent-encoded because
   * the live API is verified to accept that form.
   */
  async fetchDaily(startUtc: DateTime, endUtc: DateTime, idema: string): Promise<DailyClimatologyRecord[]> {
    const collected: DailyClimatologyRecord[] = [];
    for (const window of splitIntoWindows(startUtc, endUtc, MAX_WINDOW_DAYS)) {
      const ini = encodeURIComponent(window.start.toUTC().toFormat("yyyy-MM-dd'T'HH:mm:ss'UTC'"));
      const fin = encodeURIComponent(window.end.toUTC().toFormat("yyyy-MM-dd'T'HH:mm:ss'UTC'"));
      const url =
        `${this.baseUrl}/valores/climatologicos/diarios/datos/fechaini/${ini}` +
        `/fechafin/${fin}/estacion/${encodeURIComponent(idema)}` +
        `?api_key=${encodeURIComponent(this.apiKey)}`;

      const envelope = await this.getJson<AemetEnvelope>(url);
      if (envelope.estado !== 200 || typeof envelope.datos !== 'string') {
        // AEMET reports "no data" as HTTP 200 + estado 404 in the envelope (verified quirk).
        if (envelope.estado === 404) {
          throw new HttpError(404, 'no_data', 'AEMET has no climatology for the requested station and time range.');
        }
        throw new HttpError(
          502,
          'aemet_upstream_error',
          `AEMET responded with estado ${String(envelope.estado)}: ${String(envelope.descripcion)}`,
        );
      }

      const data = await this.getJson<AemetRawRecord[]>(envelope.datos);
      collected.push(...(Array.isArray(data) ? data : []).map(toDailyRecord));
    }
    // Merge windows: sort chronologically, dedupe a date repeated at a window boundary.
    collected.sort((a, b) => a.date.localeCompare(b.date));
    return collected.filter((record, i) => i === 0 || record.date !== collected[i - 1]?.date);
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
