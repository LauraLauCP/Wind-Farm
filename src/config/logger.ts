import pino from 'pino';
import { env } from './env.js';

/**
 * Structured logger (Q7: proper logging for troubleshooting). JSON to
 * stdout, level via LOG_LEVEL. Never log upstream URLs: they embed the
 * AEMET API key as a query parameter.
 */
export const logger = pino({ level: env.LOG_LEVEL });
