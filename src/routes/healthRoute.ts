import { Router } from 'express';
import type { StationCatalogRepository } from '../storage/stationCatalogRepository.js';
import type { ReadingsRepository } from '../storage/readingsRepository.js';

/**
 * GET /api/health (Q16): liveness of the API and its SQLite cache, so
 * operations can monitor availability during business hours.
 */
export function healthRouter(deps: {
  catalogRepo: StationCatalogRepository;
  readingsRepo: ReadingsRepository;
}): Router {
  const router = Router();
  router.get('/health', (_req, res) => {
    const healthy = deps.catalogRepo.isHealthy() && deps.readingsRepo.isHealthy();
    res.status(healthy ? 200 : 503).json({ status: healthy ? 'ok' : 'error' });
  });
  return router;
}
