import { env } from '../config/env.js';
import { HttpError } from '../domain/errors.js';

/** One raw station row of the AEMET inventory ("inventario de estaciones"). */
export interface InventoryStation {
  readonly indicativo?: unknown;
  readonly nombre?: unknown;
  readonly provincia?: unknown;
  readonly latitud?: unknown;
  readonly longitud?: unknown;
  readonly altitud?: unknown;
  [field: string]: unknown;
}

/** Envelope returned by every AEMET OpenData endpoint (two-step fetch). */
interface AemetEnvelope {
  descripcion?: unknown;
  estado?: unknown;
  datos?: unknown;
}

export class AemetInventoryClient {
  constructor(
    private readonly baseUrl: string = env.AEMET_BASE_URL,
    private readonly apiKey: string = env.AEMET_API_KEY,
  ) {}

  /**
   * Retrieves the full meteorological station inventory (~926 stations).
   *
   * Verified quirk: AEMET serves this resource as latin-1, so the bytes are
   * decoded strictly — UTF-8 first, falling back to windows-1252 when the
   * payload is not valid UTF-8. A naive `Response.json()` garbles station names.
   */
  async fetchAllStations(): Promise<InventoryStation[]> {
    const url =
      `${this.baseUrl}/valores/climatologicos/inventarioestaciones/todasestaciones` +
      `?api_key=${encodeURIComponent(this.apiKey)}`;

    const envelope = await this.getJson<AemetEnvelope>(url);
    if (envelope.estado !== 200 || typeof envelope.datos !== 'string') {
      throw new HttpError(
        502,
        'aemet_upstream_error',
        `AEMET responded with estado ${String(envelope.estado)}: ${String(envelope.descripcion)}`,
      );
    }

    const bytes = await this.fetchBytes(envelope.datos);
    const text = this.decodeBody(bytes);
    const data = JSON.parse(text) as unknown;
    return Array.isArray(data) ? (data as InventoryStation[]) : [];
  }

  /** Strict decode: UTF-8 when valid, otherwise windows-1252 (latin-1). */
  private decodeBody(bytes: ArrayBuffer): string {
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      return new TextDecoder('windows-1252').decode(bytes);
    }
  }

  private async fetchBytes(url: string): Promise<ArrayBuffer> {
    let response: Response;
    try {
      response = await fetch(url, { headers: { Accept: 'application/json' } });
    } catch {
      throw new HttpError(503, 'aemet_unreachable', 'Could not reach the AEMET OpenData API.');
    }
    if (!response.ok) {
      throw new HttpError(502, 'aemet_upstream_error', `Unexpected response from the AEMET API (HTTP ${response.status}).`);
    }
    return response.arrayBuffer();
  }

  private async getJson<T>(url: string): Promise<T> {
    const bytes = await this.fetchBytes(url);
    return JSON.parse(this.decodeBody(bytes)) as T;
  }
}
