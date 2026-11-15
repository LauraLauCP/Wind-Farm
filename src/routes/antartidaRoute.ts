import { type NextFunction, type Request, type Response, Router } from 'express';
import type { AemetReadingsFetcher } from '../client/aemetClient.js';
import { type DataType } from '../domain/dataTypes.js';
import { badRequest } from '../domain/errors.js';
import { findStation, validStationIds } from '../domain/stations.js';
import { type Aggregation } from '../services/aggregationService.js';
import { buildDataset } from '../services/antartidaService.js';
import { parseInputDateTime } from '../services/timeService.js';
import { parseRouteQuery, parseTypes, pathParam } from './requestParsing.js';

export function antartidaRouter(fetcher: AemetReadingsFetcher): Router {
  const router = Router();

  router.get(
    '/antartida/datos/fechaini/:fechaIni/fechafin/:fechaFin/estacion/:estacion',
    (req: Request, res: Response, next: NextFunction) => {
      handleAntartidaRequest(req, res, fetcher).catch(next);
    },
  );

  return router;
}

async function handleAntartidaRequest(
  req: Request,
  res: Response,
  fetcher: AemetReadingsFetcher,
): Promise<void> {
  const query = parseRouteQuery(req);

  const station = findStation(pathParam(req, 'estacion'));
  if (station === undefined) {
    throw badRequest(
      `Unknown station "${pathParam(req, 'estacion')}". Valid stations: ${validStationIds().join(', ')}.`,
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

  const raw = await fetcher.fetchReadings(startUtc, endUtc, station.aemetId);
  const dataset = buildDataset(raw, { station, startUtc, endUtc, aggregation, types });

  res.json(dataset);
}
