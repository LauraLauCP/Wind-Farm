import { DateTime } from 'luxon';

export interface TimeWindow {
  readonly start: DateTime;
  readonly end: DateTime;
}

/**
 * Splits a time range into consecutive windows of at most `maxDays` days
 * (start-inclusive, end-exclusive tiling; the final window may be shorter).
 */
export function splitIntoWindows(startUtc: DateTime, endUtc: DateTime, maxDays: number): TimeWindow[] {
  const windows: TimeWindow[] = [];
  let cursor = startUtc;
  while (cursor < endUtc) {
    const windowEnd = DateTime.min(cursor.plus({ days: maxDays }), endUtc);
    windows.push({ start: cursor, end: windowEnd });
    cursor = windowEnd;
  }
  return windows;
}
