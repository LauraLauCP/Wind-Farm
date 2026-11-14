import { DateTime, Info } from 'luxon';
import { badRequest } from '../domain/errors.js';

/** Time zone of the output dataset, as required by the challenge (CET/CEST). */
export const OUTPUT_TIMEZONE = 'Europe/Madrid';

/** Exact shape required by the challenge: YYYY-MM-DDTHH:MM:SS. */
const DATETIME_FORMAT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;

/** Fixed UTC offsets accepted as an alternative to an IANA zone (e.g. +02:00, -05:30). */
const OFFSET_PATTERN = /^([+-])(\d{2}):(\d{2})$/;

/**
 * Parses a user-supplied datetime string (`YYYY-MM-DDTHH:MM:SS`, wall time)
 * into a UTC instant. The wall time is interpreted in:
 *  - the IANA time zone given by `location` (e.g. "Europe/Berlin"), or
 *  - the fixed UTC offset given by `location` (e.g. "+02:00"), or
 *  - UTC when no location is provided (documented default).
 *
 * Throws an HttpError(400) for anything that is not a valid instant.
 */
export function parseInputDateTime(value: string, location: string | undefined): DateTime {
  if (!DATETIME_FORMAT.test(value)) {
    throw badRequest(
      `Invalid datetime "${value}". Expected format YYYY-MM-DDTHH:MM:SS (e.g. 2026-10-01T00:00:00).`,
    );
  }

  let instant: DateTime<boolean>;
  const offsetMatch = OFFSET_PATTERN.exec(location ?? '');
  if (location === undefined || location === '') {
    // No location: the datetimes are interpreted in UTC by default.
    instant = DateTime.fromISO(value, { zone: 'utc' });
  } else if (offsetMatch !== null) {
    // Fixed offset: append it to the wall time to get a fully-specified ISO instant.
    // Luxon accepts out-of-range offsets silently, so validate the bounds here.
    const hours = Number(offsetMatch[2]);
    const minutes = Number(offsetMatch[3]);
    if (!(hours >= 0 && hours <= 23) || !(minutes >= 0 && minutes <= 59)) {
      throw badRequest(
        `Invalid UTC offset "${location}". Hours must be ≤ 23 and minutes ≤ 59.`,
      );
    }
    instant = DateTime.fromISO(`${value}${location}`, { zone: 'utc' });
  } else if (Info.isValidIANAZone(location)) {
    // IANA zone name: interpret the wall time in that zone (DST-aware).
    instant = DateTime.fromISO(value, { zone: location });
  } else {
    throw badRequest(
      `Invalid location "${location}". Use an IANA time zone name (e.g. Europe/Berlin) or a UTC offset (e.g. +02:00).`,
    );
  }

  if (!instant.isValid) {
    throw badRequest(
      `Invalid datetime "${value}" for location "${location ?? 'UTC'}": ${instant.invalidReason ?? 'unknown reason'}.`,
    );
  }
  return instant.toUTC();
}

/**
 * Formats a UTC instant as ISO 8601 in the output time zone (Europe/Madrid),
 * always including the CET/CEST offset (e.g. 2026-10-01T12:00:00+02:00).
 */
export function toOutputIso(instant: DateTime): string {
  const formatted = instant.toUTC().setZone(OUTPUT_TIMEZONE).toISO({ suppressMilliseconds: true });
  if (formatted === null) {
    // Defensive: an already-validated DateTime always formats.
    throw new Error(`Failed to format datetime: ${instant.toString()}`);
  }
  return formatted;
}
