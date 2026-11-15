import express, { type Express } from 'express';
import { AemetClient, type AemetReadingsFetcher } from './client/aemetClient.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { antartidaRouter } from './routes/antartidaRoute.js';
import { datosRouter, type DatosDependencies } from './routes/datosRoute.js';

/**
 * Assembles the Express application. The AEMET fetcher is injected so tests
 * can run the full HTTP stack without touching the real AEMET API. The
 * optional `datos` dependencies mount the generalized Part 2 route; in
 * production the server bootstrap wires them to SQLite.
 */
export function createApp(
  fetcher: AemetReadingsFetcher = new AemetClient(),
  datos?: DatosDependencies,
): Express {
  const app = express();
  app.disable('x-powered-by');

  app.use('/api', antartidaRouter(fetcher));
  if (datos !== undefined) {
    app.use('/api', datosRouter(datos));
  }

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
