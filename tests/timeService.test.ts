import { describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import { parseInputDateTime, toOutputIso } from '../src/services/timeService.js';
import { HttpError } from '../src/domain/errors.js';

describe('parseInputDateTime', () => {
  it('interprets datetimes as UTC when no location is given', () => {
    const instant = parseInputDateTime('2026-08-01T12:00:00', undefined);
    expect(instant.toISO()).toBe('2026-08-01T12:00:00.000Z');
  });

  it('treats an empty location as UTC too', () => {
    const instant = parseInputDateTime('2026-08-01T12:00:00', '');
    expect(instant.toISO()).toBe('2026-08-01T12:00:00.000Z');
  });

  it('interprets datetimes in an IANA time zone (Europe/Berlin, CEST +02:00 in summer)', () => {
    const instant = parseInputDateTime('2026-08-01T12:00:00', 'Europe/Berlin');
    expect(instant.toISO()).toBe('2026-08-01T10:00:00.000Z');
  });

  it('interprets datetimes in an IANA time zone (Europe/Madrid, CET +01:00 in winter)', () => {
    const instant = parseInputDateTime('2026-01-15T12:00:00', 'Europe/Madrid');
    expect(instant.toISO()).toBe('2026-01-15T11:00:00.000Z');
  });

  it('accepts a fixed UTC offset as an alternative to a zone name', () => {
    const instant = parseInputDateTime('2026-08-01T12:00:00', '+02:00');
    expect(instant.toISO()).toBe('2026-08-01T10:00:00.000Z');

    const negative = parseInputDateTime('2026-08-01T12:00:00', '-05:30');
    expect(negative.toISO()).toBe('2026-08-01T17:30:00.000Z');
  });

  it('rejects datetimes that do not match YYYY-MM-DDTHH:MM:SS', () => {
    expect(() => parseInputDateTime('2026-08-01 12:00:00', undefined)).toThrow(HttpError);
    expect(() => parseInputDateTime('2026-08-01T12:00', undefined)).toThrow(HttpError);
    expect(() => parseInputDateTime('01-08-2026T12:00:00', undefined)).toThrow(/format/i);
  });

  it('rejects impossible dates', () => {
    expect(() => parseInputDateTime('2026-13-01T00:00:00', undefined)).toThrow(HttpError);
  });

  it('rejects invalid locations', () => {
    expect(() => parseInputDateTime('2026-08-01T12:00:00', 'Mars/Olympus')).toThrow(/location/i);
    expect(() => parseInputDateTime('2026-08-01T12:00:00', '+99:00')).toThrow(HttpError);
  });
});

describe('toOutputIso (Europe/Madrid, DST aware)', () => {
  it('renders CET with the +01:00 offset in winter', () => {
    expect(toOutputIso(DateTime.fromISO('2026-01-15T12:00:00Z'))).toBe('2026-01-15T13:00:00+01:00');
  });

  it('renders CEST with the +02:00 offset in summer', () => {
    expect(toOutputIso(DateTime.fromISO('2026-08-01T12:00:00Z'))).toBe('2026-08-01T14:00:00+02:00');
  });

  it('handles the spring DST transition (2026-03-29: 02:00 CET → 03:00 CEST)', () => {
    
    expect(toOutputIso(DateTime.fromISO('2026-03-29T00:30:00Z'))).toBe('2026-03-29T01:30:00+01:00');
    
    expect(toOutputIso(DateTime.fromISO('2026-03-29T01:30:00Z'))).toBe('2026-03-29T03:30:00+02:00');
  });

  it('handles the autumn DST transition (2026-10-25: 03:00 CEST → 02:00 CET)', () => {
    
    expect(toOutputIso(DateTime.fromISO('2026-10-25T00:30:00Z'))).toBe('2026-10-25T02:30:00+02:00');
    expect(toOutputIso(DateTime.fromISO('2026-10-25T01:30:00Z'))).toBe('2026-10-25T02:30:00+01:00');
  });
});
