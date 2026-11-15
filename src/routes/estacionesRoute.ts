import { type Request, type Response, Router } from 'express';
import { z } from 'zod';
import { firstValue } from './requestParsing.js';
import { badRequest } from '../domain/errors.js';
import type { StationCatalogRepository } from '../storage/stationCatalogRepository.js';

/** One entry of the station picker payload (Part 3). */
export interface PickerStation {
  readonly id: string;
  readonly name: string;
  readonly province: string | null;
  readonly latitude: number | null;
  readonly longitude: number | null;
}

/** Max stations one picker query may return — keeps responses bounded. */
export const MAX_PICKER_RESULTS = 500;
const DEFAULT_PICKER_RESULTS = 100;

const EstacionesQuerySchema = z.object({
  search: z.preprocess(firstValue, z.string().trim().optional()),
  limit: z.preprocess(firstValue, z.coerce.number().int().min(1).max(MAX_PICKER_RESULTS).default(DEFAULT_PICKER_RESULTS)),
});

/**
 * GET /api/estaciones (Part 3): the station catalog that feeds the front-end
 * station picker, optionally filtered by ?search= over id/name/province and
 * capped with ?limit= (default 100, max 500).
 */
export function estacionesRouter(deps: { catalogRepo: StationCatalogRepository }): Router {
  const router = Router();
  router.get('/estaciones', (req: Request, res: Response) => {
    const parsed = EstacionesQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw badRequest('Invalid query parameters.', parsed.error.issues);
    }
    const { search, limit } = parsed.data;
    const stations = deps.catalogRepo
      .searchStations(search === '' ? undefined : search, limit)
      .map<PickerStation>((station) => ({
        id: station.id,
        name: station.name,
        province: station.province,
        latitude: station.latitude,
        longitude: station.longitude,
      }));
    res.json({ count: stations.length, stations });
  });
  return router;
}
