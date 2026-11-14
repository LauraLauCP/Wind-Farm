/**
 * Application error that can be translated into an HTTP response by the
 * error-handling middleware. `code` is a stable, machine-readable identifier
 * so API consumers can branch on it without parsing messages.
 */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export function badRequest(message: string, details?: unknown): HttpError {
  return new HttpError(400, 'bad_request', message, details);
}
