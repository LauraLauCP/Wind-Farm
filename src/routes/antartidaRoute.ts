import { type NextFunction, type Request, type Response, Router } from 'express';
import { z } from 'zod';
import type { AemetReadingsFetcher } from '../client/aemetClient.js';
import { DATA_TYPES, isDataType, type DataType } from '../domain/dataTypes.js';
import { badRequest } from '../domain/errors.js';
import { findStation, validStationIds } from '../domain/stations.js';
import { AGGREGATIONS, type Aggregation } from '../services/aggregationService.js';
import { buildDataset } from '../services/antartidaService.js';
import { parseInputDateTime } from '../services/timeService.js';

/** Query strings are plain strings for us, even when repeated (?types=a&types=b → first wins). */
const firstValue = (value: unknown) => (Array.isArray(value) ? value[0] : value);

const QuerySchema = z.object({
  location: z.preprocess(firstValue, z.string().trim().optional()),
  aggregation: z.preprocess(firstValue, z.enum(AGGREGATIONS).optional()),
  types: z.preprocess(firstValue, z.string().trim().optional()),
});

/**
 * Parses the "types" query parameter: a comma-separated list of data types.
 * Absent or empty means "all data types" (challenge requirement).
 */
function parseTypes(raw: string | undefined): DataType[] {
  if (raw === undefined || raw === '') {
    return [...DATA_TYPES];
  }
  const requested = [
    ...new Set(
      raw
        .split(',')
        .map((type) => type.trim().toLowerCase())
        .filter((type) => type !== ''),
    ),
  ];
  const invalid = requested.filter((type) => !isDataType(type));
  if (invalid.length > 0) {
    throw badRequest(
      `Invalid data type(s): ${invalid.join(', ')}. Valid types: ${DATA_TYPES.join(', ')}.`,
    );
  }
  return requested.filter(isDataType);
}

/**
 * Extracts a single path parameter. Express 5 types allow `string[]` there
 * (repeated segments), so we normalize to the first value.
 */
function pathParam(req: Request, name: string): string {
  const value = req.params[name];
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

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
  const parsedQuery = QuerySchema.safeParse(req.query);
  if (!parsedQuery.success) {
    throw badRequest('Invalid query parameters.', parsedQuery.error.issues);
  }
  const query = parsedQuery.data;

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
