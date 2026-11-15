import type { DatasetResponse, EstacionesResponse } from './contract';

/** An error envelope from the API: {error: {code, message}}. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

/** Parses the API's error envelope, degrading gracefully off-spec. */
async function toApiError(response: Response): Promise<ApiError> {
  try {
    const body = (await response.json()) as { error?: { code?: string; message?: string } };
    return new ApiError(
      response.status,
      body.error?.code ?? 'unknown_error',
      body.error?.message ?? `Request failed with status ${response.status}.`,
    );
  } catch {
    return new ApiError(response.status, 'unknown_error', `Request failed with status ${response.status}.`);
  }
}

async function fetchJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  if (!response.ok) {
    throw await toApiError(response);
  }
  return (await response.json()) as T;
}

/** GET /api/datos/... — `url` comes from buildDatosQuery. */
export function fetchDataset(url: string, signal: AbortSignal): Promise<DatasetResponse> {
  return fetchJson<DatasetResponse>(url, signal);
}

/** GET /api/estaciones — feeds the station picker. */
export function fetchEstaciones(search: string, signal: AbortSignal, limit = 100): Promise<EstacionesResponse> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (search !== '') {
    params.set('search', search);
  }
  return fetchJson<EstacionesResponse>(`/api/estaciones?${params.toString()}`, signal);
}
