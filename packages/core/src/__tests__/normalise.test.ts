import { describe, expect, it } from 'vitest';
import {
  MIN_TRACKS_FOR_PERCENTILES,
  addSample,
  createHistogram,
  createLibraryStatistics,
  normaliseFeatures,
  percentileOf,
  recordFeatures,
} from '../normalise.js';
import type { RawFeatures } from '../types.js';

function features(overrides: Partial<RawFeatures> = {}): RawFeatures {
  return {
    bpm: 120,
    bpmConfidence: 0.9,
    keyRoot: 'C',
    keyScale: 'major',
    keyStrength: 0.8,
    keyMargin: 0.3,
    loudnessDb: -12,
    rmsMean: 0.2,
    crestFactor: 5,
    centroidHzMean: 2000,
    fluxMean: 10,
    zcrMean: 0.1,
    danceabilityRaw: 0.6,
    windows: [],
    ...overrides,
  };
}

describe('histogram', () => {
  it('needs a positive range', () => {
    expect(() => createHistogram(1, 1)).toThrow(/max > min/);
    expect(() => createHistogram(2, 1)).toThrow(/max > min/);
  });

  it('answers half for an empty distribution rather than zero', () => {
    expect(percentileOf(createHistogram(0, 1), 0.9)).toBe(0.5);
  });

  it('puts a value at its rank in a uniform distribution', () => {
    const histogram = createHistogram(0, 100);
    for (let i = 0; i < 100; i++) addSample(histogram, i);

    expect(percentileOf(histogram, 0)).toBeCloseTo(0, 2);
    expect(percentileOf(histogram, 50)).toBeCloseTo(0.5, 2);
    expect(percentileOf(histogram, 99)).toBeCloseTo(0.99, 2);
  });

  it('clamps values outside the range into the end buckets', () => {
    const histogram = createHistogram(0, 10);
    for (let i = 0; i < 10; i++) addSample(histogram, i);
    expect(percentileOf(histogram, -100)).toBe(0);
    expect(percentileOf(histogram, 1000)).toBeLessThanOrEqual(1);
    expect(percentileOf(histogram, 1000)).toBeGreaterThan(0.8);
  });

  it('spreads values that all land in one bucket', () => {
    // The case that matters for a small or very uniform library: without
    // interpolation inside the bucket every track would get the same percentile.
    const histogram = createHistogram(0, 100);
    for (let i = 0; i < 50; i++) addSample(histogram, 0.5);
    expect(percentileOf(histogram, 0.1)).toBeLessThan(percentileOf(histogram, 0.9));
  });

  it('never leaves 0..1', () => {
    const histogram = createHistogram(-5, 5);
    for (const value of [-10, -5, 0, 5, 10, NaN, Infinity, -Infinity]) addSample(histogram, value);
    for (const value of [-100, 0, 100, NaN]) {
      const percentile = percentileOf(histogram, value);
      expect(percentile).toBeGreaterThanOrEqual(0);
      expect(percentile).toBeLessThanOrEqual(1);
    }
  });
});

describe('normaliseFeatures', () => {
  it('marks a small library provisional and still returns usable numbers', () => {
    const statistics = createLibraryStatistics();
    const analysis = normaliseFeatures(features(), statistics);

    expect(analysis.provisional).toBe(true);
    for (const value of [
      analysis.energy,
      analysis.brightness,
      analysis.compression,
      analysis.danceability,
    ]) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it('stops being provisional once enough tracks are in', () => {
    const statistics = createLibraryStatistics();
    for (let i = 0; i < MIN_TRACKS_FOR_PERCENTILES; i++) {
      recordFeatures(statistics, features({ rmsMean: i / 200 }));
    }
    expect(normaliseFeatures(features(), statistics).provisional).toBe(false);
  });

  it('ranks a loud track above a quiet one within the same library', () => {
    const statistics = createLibraryStatistics();
    for (let i = 0; i < 100; i++) recordFeatures(statistics, features({ rmsMean: i / 400 }));

    const quiet = normaliseFeatures(features({ rmsMean: 0.02 }), statistics);
    const loud = normaliseFeatures(features({ rmsMean: 0.23 }), statistics);
    expect(loud.energy).toBeGreaterThan(quiet.energy);
  });

  it('is relative to the library, not to an absolute scale', () => {
    // The point of the whole module: the same track is "quiet" in a loud library
    // and "loud" in a quiet one.
    const loudLibrary = createLibraryStatistics();
    for (let i = 0; i < 100; i++) recordFeatures(loudLibrary, features({ rmsMean: 0.3 }));
    const quietLibrary = createLibraryStatistics();
    for (let i = 0; i < 100; i++) recordFeatures(quietLibrary, features({ rmsMean: 0.02 }));

    const subject = features({ rmsMean: 0.1 });
    expect(normaliseFeatures(subject, loudLibrary).energy).toBeLessThan(
      normaliseFeatures(subject, quietLibrary).energy,
    );
  });

  it('scores a brickwalled master high on compression and an open one low', () => {
    const statistics = createLibraryStatistics();
    for (let i = 0; i < 100; i++)
      recordFeatures(statistics, features({ crestFactor: 1.5 + i / 10 }));

    const squashed = normaliseFeatures(features({ crestFactor: 2 }), statistics);
    const open = normaliseFeatures(features({ crestFactor: 11 }), statistics);
    expect(squashed.compression).toBeGreaterThan(open.compression);
    expect(squashed.compression).toBeGreaterThan(0.8);
    expect(open.compression).toBeLessThan(0.2);
  });

  it('carries the key through as a Camelot code', () => {
    const analysis = normaliseFeatures(
      features({ keyRoot: 'A', keyScale: 'minor' }),
      createLibraryStatistics(),
    );
    expect(analysis.key.camelot).toBe('8A');
    expect(analysis.key.root).toBe('A');
  });

  it('passes tempo through untouched, because BPM is not a percentile', () => {
    const analysis = normaliseFeatures(features({ bpm: 174 }), createLibraryStatistics());
    expect(analysis.bpm).toBe(174);
  });
});
