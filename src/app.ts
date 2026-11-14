import express, { type Express } from 'express';
import { AemetClient, type AemetReadingsFetcher } from './client/aemetClient.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { antartidaRouter } from './routes/antartidaRoute.js';

/**
 * Assembles the Express application. The AEMET fetcher is injected so tests
 * can run the full HTTP stack without touching the real AEMET API.
 */
export function createApp(fetcher: AemetReadingsFetcher = new AemetClient()): Express {
  const app = express();
  app.disable('x-powered-by');

  app.use('/api', antartidaRouter(fetcher));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
