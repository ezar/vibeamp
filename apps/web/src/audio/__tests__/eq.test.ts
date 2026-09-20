import { describe, expect, it } from 'vitest';
import type { Band } from 'webamp';
import { EQ_BANDS, MAX_BAND_DB, dbToGain, sliderToDb } from '../eq.js';

describe('EQ_BANDS', () => {
  it('is Winamp’s own ten frequencies, in order', () => {
    expect([...EQ_BANDS]).toEqual([60, 170, 310, 600, 1000, 3000, 6000, 12000, 14000, 16000]);
  });

  it('is exactly the set the shell declares', () => {
    // A compile-time assertion, which is the only place this can be checked: the
    // shell's slider type and our filter frequencies have to be the same set, or a
    // slider moves a frequency nothing filters. Assigning each way proves neither
    // side has one the other lacks.
    const ours: readonly Band[] = EQ_BANDS;
    const theirs: readonly (typeof EQ_BANDS)[number][] = ours;
    expect(theirs).toHaveLength(10);
  });
});

describe('sliderToDb', () => {
  it('treats the middle of the shell’s range as no change', () => {
    expect(sliderToDb(50)).toBe(0);
  });

  it('reaches the full cut and boost at the ends', () => {
    expect(sliderToDb(100)).toBe(MAX_BAND_DB);
    expect(sliderToDb(0)).toBe(-MAX_BAND_DB);
  });

  it('clamps a value outside the range instead of exceeding the band', () => {
    expect(sliderToDb(500)).toBe(MAX_BAND_DB);
    expect(sliderToDb(-500)).toBe(-MAX_BAND_DB);
  });

  it('is linear in between', () => {
    expect(sliderToDb(75)).toBeCloseTo(MAX_BAND_DB / 2, 6);
    expect(sliderToDb(25)).toBeCloseTo(-MAX_BAND_DB / 2, 6);
  });
});

describe('dbToGain', () => {
  it('leaves a signal alone at zero decibels', () => {
    expect(dbToGain(0)).toBe(1);
  });

  it('halves the amplitude at about minus six decibels', () => {
    expect(dbToGain(-6.02)).toBeCloseTo(0.5, 3);
  });

  it('doubles it at about plus six', () => {
    expect(dbToGain(6.02)).toBeCloseTo(2, 2);
  });

  it('backs out a full boost exactly, which is what the headroom gain relies on', () => {
    // The headroom gain is dbToGain(-boost); together the two must come back to
    // unity, or the compensation itself changes the level.
    expect(dbToGain(MAX_BAND_DB) * dbToGain(-MAX_BAND_DB)).toBeCloseTo(1, 10);
  });
});
