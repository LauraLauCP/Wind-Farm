/** How far back the default query range reaches (agreed default: last 7 days). */
export const DEFAULT_RANGE_DAYS = 7;

/** The IANA zone the form's wall times are expressed in (agreed default). */
export const DEFAULT_LOCATION = 'Europe/Madrid';

/**
 * Formats an instant as a wall time in `zone`, in the API's input format
 * YYYY-MM-DDTHH:MM:SS (seconds floored away).
 */
export function formatWallTime(instant: Date, zone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:00`;
}

/**
 * The default query range: the last 7 days ending at `now`, expressed as
 * wall times in the default location. Each bound is formatted in the offset
 * in force on its own date, so ranges crossing a DST change stay correct.
 */
export function defaultRange(now: Date, zone = DEFAULT_LOCATION): { start: string; end: string } {
  const start = new Date(now.getTime() - DEFAULT_RANGE_DAYS * 24 * 60 * 60 * 1000);
  return {
    start: formatWallTime(start, zone),
    end: formatWallTime(now, zone),
  };
}
