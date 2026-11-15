import { describe, expect, it } from 'vitest';
import { defaultRange } from './dates';

describe('defaultRange', () => {
  it('returns the last 7 days as Madrid wall times (YYYY-MM-DDTHH:MM:SS)', () => {
    const now = new Date('2026-11-15T12:00:00Z'); // 13:00 in Madrid
    expect(defaultRange(now)).toEqual({
      start: '2026-11-08T13:00:00',
      end: '2026-11-15T13:00:00',
    });
  });

  it('formats each end of the range in the offset in force on that date (DST)', () => {
    // 2026-03-29 is the EU spring-forward Sunday: Madrid jumps 02:00 → 03:00.
    const now = new Date('2026-03-29T01:30:00Z'); // 03:30 at +02:00
    expect(defaultRange(now)).toEqual({
      start: '2026-03-22T02:30:00', // 01:30Z was +01:00 a week earlier
      end: '2026-03-29T03:30:00',
    });
  });

  it('formats midnight as 00, never as hour 24', () => {
    const now = new Date('2026-11-15T23:00:00Z'); // 00:00 next day in Madrid
    expect(defaultRange(now).end).toBe('2026-11-16T00:00:00');
  });
});
