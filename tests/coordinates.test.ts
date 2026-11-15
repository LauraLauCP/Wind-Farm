import { describe, expect, it } from 'vitest';
import { parseDmsToDecimal } from '../src/domain/coordinates.js';

describe('parseDmsToDecimal', () => {
  it('converts AEMET ddmmss + hemisphere coordinates to signed decimal degrees', () => {
    // Worked examples from the live inventory fixture:
    // 39°49'24"N (Lluc, Mallorca)
    expect(parseDmsToDecimal('394924N')).toBeCloseTo(39.823333, 4);
    // 02°53'09"E (Lluc, Mallorca)
    expect(parseDmsToDecimal('025309E')).toBeCloseTo(2.885833, 4);
    // 28°58'11"N (Tías, Gran Canaria)
    expect(parseDmsToDecimal('285811N')).toBeCloseTo(28.969722, 4);
    // 13°41'25"W — western hemisphere must be negative
    expect(parseDmsToDecimal('134125W')).toBeCloseTo(-13.690278, 4);
    // Southern hemisphere too (AEMET also has southern stations)
    expect(parseDmsToDecimal('340015S')).toBeCloseTo(-34.004167, 4);
  });

  it('returns null for anything that is not a ddmmss + hemisphere value', () => {
    expect(parseDmsToDecimal('')).toBeNull();
    expect(parseDmsToDecimal('not-a-coordinate')).toBeNull();
    expect(parseDmsToDecimal('123456')).toBeNull();
  });
});
