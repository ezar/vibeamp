/**
 * Playing a collection at one volume.
 *
 * Two things have to be true of every number here. A quiet track must come up and a
 * loud one must come down, by the difference between them and the middle of the
 * library — and nothing must ever be turned up into the ceiling, which is the only
 * way this feature can make a recording worse rather than merely different.
 */

import { describe, expect, it } from 'vitest';
import {
  MAX_TRIM_DB,
  MIN_TRACKS_FOR_LEVELLING,
  PEAK_MARGIN_DB,
  referenceLoudnessDb,
  trimDb,
} from '../levelling.js';
import { addSample, createLibraryStatistics } from '../normalise.js';
import { makeTrack } from './tracks.js';
import type { Track } from '../types.js';

/** A track at a known level, with a known distance from its peaks to that level. */
function atLevel(id: string, loudnessDb: number, crestFactor = 6): Track {
  const track = makeTrack({ id });
  if (track.analysis === null) throw new Error('the fixture should be analysed');
  return {
    ...track,
    analysis: {
      ...track.analysis,
      loudnessDb,
      inputs: { ...track.analysis.inputs, compression: crestFactor },
    },
  };
}

/** Statistics whose loudness median is a known RMS. */
function libraryAt(rms: number, count = 40) {
  const statistics = createLibraryStatistics();
  for (let i = 0; i < count; i += 1) addSample(statistics.loudness, rms);
  return statistics;
}

describe('the reference', () => {
  it('is the middle of the library, in dBFS', () => {
    // 0.1 RMS is -20 dBFS. The histogram is a hundred buckets wide, so the median
    // is right to about a decibel — which is all a common-mode shift needs to be.
    const reference = referenceLoudnessDb(libraryAt(0.1));
    expect(reference).not.toBeNull();
    expect(reference ?? 0).toBeGreaterThan(-21);
    expect(reference ?? 0).toBeLessThan(-19);
  });

  it('refuses to exist until there is a library to be the middle of', () => {
    expect(referenceLoudnessDb(libraryAt(0.1, MIN_TRACKS_FOR_LEVELLING - 1))).toBeNull();
    expect(referenceLoudnessDb(createLibraryStatistics())).toBeNull();
  });
});

describe('the trim', () => {
  it('brings a quiet track up and a loud one down, by the difference', () => {
    expect(trimDb(atLevel('quiet', -26), -20)).toBeCloseTo(6, 6);
    expect(trimDb(atLevel('loud', -14), -20)).toBeCloseTo(-6, 6);
    expect(trimDb(atLevel('middle', -20), -20)).toBeCloseTo(0, 6);
  });

  it('will not turn a track up into the ceiling', () => {
    // A brickwalled master: a crest factor of 1.2 puts its peaks 1.6 dB above its
    // RMS, so a track at -3 dBFS RMS is already almost at full scale.
    const brickwalled = atLevel('loud-master', -3, 1.2);
    expect(trimDb(brickwalled, 6)).toBe(0);

    // One with room in it comes up, but only into the room it has: at -20 dBFS
    // with a crest factor of 6 its peaks are already at -4.4, so the eight
    // decibels it is short of the reference become two and a half.
    const roomy = atLevel('roomy', -20, 6);
    const peakDb = -20 + 20 * Math.log10(6);
    expect(trimDb(roomy, -12)).toBeCloseTo(-peakDb - PEAK_MARGIN_DB, 6);
    expect(trimDb(roomy, -12)).toBeLessThan(8);
  });

  it('never moves anything more than the limit, either way', () => {
    expect(trimDb(atLevel('whisper', -60, 20), -10)).toBeLessThanOrEqual(MAX_TRIM_DB);
    expect(trimDb(atLevel('shout', -3, 1.1), -40)).toBe(-MAX_TRIM_DB);
  });

  it('leaves a track it cannot measure exactly as it was', () => {
    const unanalysed = makeTrack({ id: 'pending', analysed: false });
    expect(trimDb(unanalysed, -20)).toBe(0);
    expect(trimDb(atLevel('fine', -26), null)).toBe(0);
    expect(trimDb(atLevel('broken', Number.NaN), -20)).toBe(0);
    expect(trimDb(atLevel('no-crest', -30, 0), -20)).toBe(0);
  });
});
