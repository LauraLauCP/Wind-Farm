import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { HttpError } from '../domain/errors.js';

/** Answers 404 for unknown routes with a consistent JSON body. */
export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: { code: 'not_found', message: `Unknown route: ${req.method} ${req.path}` },
  });
}

/**
 * Central error handler: every error thrown in the application ends up here
 * and is translated into a consistent JSON error envelope.
 */
export function errorHandler(err: unknown, req: Request, res: Response, next: NextFunction): void {
  if (res.headersSent) {
    next(err);
    return;
  }

  if (err instanceof HttpError) {
    res.status(err.status).json({
      error: {
        code: err.code,
        message: err.message,
        ...(err.details !== undefined && { details: err.details }),
      },
    });
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({
      error: { code: 'bad_request', message: 'Invalid request parameters.', details: err.issues },
    });
    return;
  }

  // Unexpected error: log it server-side, never leak internals to the client.
  console.error(`Unhandled error while processing ${req.method} ${req.originalUrl}:`, err);
  res.status(500).json({
    error: { code: 'internal_error', message: 'An unexpected error occurred.' },
  });
}
