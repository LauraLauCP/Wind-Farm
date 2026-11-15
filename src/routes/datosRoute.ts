import { type NextFunction, type Request, type Response, Router } from 'express';
import { badRequest } from '../domain/errors.js';
import type { StationCatalogRepository } from '../storage/stationCatalogRepository.js';
import type { ReadingsRepository } from '../storage/readingsRepository.js';
import type { StationDataService } from '../services/stationDataService.js';
import type { Aggregation } from '../services/aggregationService.js';
import { OUTPUT_TIMEZONE, parseInputDateTime, toOutputIso } from '../services/timeService.js';
import { parseRouteQuery, parseTypes, pathParam } from './requestParsing.js';

/** Dependencies of the generalized data route, injected by the app factory. */
export interface DatosDependencies {
  readonly catalogRepo: StationCatalogRepository;
  readonly readingsRepo: ReadingsRepository;
  readonly stationDataService: StationDataService;
}

/**
 * The canonical data route (Q2): any station of the catalog, served through
 * the read-through cache (Q1/Q9), with cache metadata in the response (Q16).
 */
export function datosRouter(deps: DatosDependencies): Router {
  const router = Router();
  router.get(
    '/datos/fechaini/:fechaIni/fechafin/:fechaFin/estacion/:estacion',
    (req: Request, res: Response, next: NextFunction) => {
      handleDatosRequest(req, res, deps).catch(next);
    },
  );
  return router;
}

async function handleDatosRequest(req: Request, res: Response, deps: DatosDependencies): Promise<void> {
  const query = parseRouteQuery(req);

  const station = deps.catalogRepo.findStation(pathParam(req, 'estacion'));
  if (station === null) {
    throw badRequest(
      `Unknown station "${pathParam(req, 'estacion')}". Use a station id from the catalog ` +
        '(e.g. 8178D, or the seeded Antarctic stations 89064 and 89070).',
    );
  }

  // Input datetimes are wall times interpreted in the requested location (UTC by default).
  const startUtc = parseInputDateTime(pathParam(req, 'fechaIni'), query.location);
  const endUtc = parseInputDateTime(pathParam(req, 'fechaFin'), query.location);
  if (startUtc >= endUtc) {
    throw badRequest('The start datetime must be earlier than the end datetime.');
  }

  const aggregation: Aggregation = query.aggregation ?? 'none';
  const types = parseTypes(query.types);

  const dataset = await deps.stationDataService.getDataset(station, startUtc, endUtc, aggregation, types);

  res.json({
    station: station.name,
    stationId: station.id,
    start: toOutputIso(startUtc),
    end: toOutputIso(endUtc),
    timezone: OUTPUT_TIMEZONE,
    aggregation,
    types,
    count: dataset.rows.length,
    data: dataset.rows,
    stale: dataset.stale,
    partial: dataset.partial,
    lastSyncedAt: dataset.lastSyncedAt === null ? null : toOutputIso(dataset.lastSyncedAt),
  });
}
