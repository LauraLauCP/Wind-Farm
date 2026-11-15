import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type Express } from 'express';
import { AemetClient, type AemetReadingsFetcher } from './client/aemetClient.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { requestLogger } from './middleware/requestLogger.js';
import { antartidaRouter } from './routes/antartidaRoute.js';
import { datosRouter, type DatosDependencies } from './routes/datosRoute.js';
import { estacionesRouter } from './routes/estacionesRoute.js';
import { healthRouter } from './routes/healthRoute.js';

/**
 * Default location of the built SPA (Part 3): repo/frontend/dist. Resolved
 * relative to this module so it works both under tsx (src/) and from the
 * compiled output (dist/). Optional so tests can point it at a temp dir —
 * or away entirely.
 */
const DEFAULT_FRONTEND_DIST = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'frontend',
  'dist',
);

/**
 * Assembles the Express application. The AEMET fetcher is injected so tests
 * can run the full HTTP stack without touching the real AEMET API. The
 * optional `datos` dependencies mount the generalized Part 2 route (and the
 * /health probe); in production the server bootstrap wires them to SQLite.
 */
export function createApp(
  fetcher: AemetReadingsFetcher = new AemetClient(),
  datos?: DatosDependencies,
  frontendDist: string | null = DEFAULT_FRONTEND_DIST,
): Express {
  const app = express();
  app.disable('x-powered-by');

  app.use(requestLogger());
  app.use('/api', antartidaRouter(fetcher));
  if (datos !== undefined) {
    app.use('/api', datosRouter(datos));
    app.use('/api', healthRouter(datos));
    app.use('/api', estacionesRouter({ catalogRepo: datos.catalogRepo }));
  }

  // Part 3: serve the built SPA from the same process when the bundle
  // exists — a backend-only checkout (no frontend build) still boots.
  if (frontendDist !== null && existsSync(frontendDist)) {
    app.use(express.static(frontendDist));
  }

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
