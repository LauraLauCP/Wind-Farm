import type { Request } from 'express';
import { z } from 'zod';
import { DATA_TYPES, isDataType, type DataType } from '../domain/dataTypes.js';
import { badRequest } from '../domain/errors.js';
import { AGGREGATIONS, type Aggregation } from '../services/aggregationService.js';

/** Query strings are plain strings for us, even when repeated (?types=a&types=b → first wins). */
export const firstValue = (value: unknown) => (Array.isArray(value) ? value[0] : value);

const QuerySchema = z.object({
  location: z.preprocess(firstValue, z.string().trim().optional()),
  aggregation: z.preprocess(firstValue, z.enum(AGGREGATIONS).optional()),
  types: z.preprocess(firstValue, z.string().trim().optional()),
});

/** Validated query of a data route (throws 400 bad_request on shape errors). */
export interface RouteQuery {
  readonly location?: string;
  readonly aggregation?: Aggregation;
  readonly types?: string;
}

export function parseRouteQuery(req: Request): RouteQuery {
  const parsed = QuerySchema.safeParse(req.query);
  if (!parsed.success) {
    throw badRequest('Invalid query parameters.', parsed.error.issues);
  }
  return parsed.data;
}

/**
 * Parses the "types" query parameter: a comma-separated list of data types.
 * Absent or empty means "all data types" (challenge requirement).
 */
export function parseTypes(raw: string | undefined): DataType[] {
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
export function pathParam(req: Request, name: string): string {
  const value = req.params[name];
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}
