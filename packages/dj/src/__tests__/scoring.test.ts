import { describe, expect, it } from 'vitest';
import {
  BPM_TOLERANCE,
  DEFAULT_WEIGHTS,
  bpmCost,
  noveltyCost,
  relativeBpmDistance,
  scoreCandidate,
  weightsForCoherence,
} from '../scoring.js';
import { targetEnergy } from '../energyCurve.js';
import { NEUTRAL_TARGET, emptyContext, makeTrack } from './tracks.js';

describe('relativeBpmDistance', () => {
  it('is zero for the same tempo', () => {
    expect(relativeBpmDistance(120, 120)).toBe(0);
  });

  it('treats half and double time as a match', () => {
    expect(relativeBpmDistance(140, 70)).toBe(0);
    expect(relativeBpmDistance(70, 140)).toBe(0);
  });

  it('is infinite when a tempo is unknown', () => {
    expect(relativeBpmDistance(0, 120)).toBe(Infinity);
    expect(relativeBpmDistance(120, 0)).toBe(Infinity);
  });
});

describe('bpmCost', () => {
  it('is zero for an exact match and one at the tolerance', () => {
    expect(bpmCost(120, 120)).toBe(0);
    expect(bpmCost(120, 120 * (1 + BPM_TOLERANCE))).toBeCloseTo(1, 6);
  });

  it('never exceeds one, however far apart the tempos are', () => {
    expect(bpmCost(60, 199)).toBe(1);
    expect(bpmCost(120, 41)).toBe(1);
  });

  it('charges the full cost when a tempo is unknown', () => {
    // Not zero: an unknown tempo must never look like a perfect transition, or
    // every unanalysed track wins.
    expect(bpmCost(0, 120)).toBe(1);
  });

  it('grows with distance', () => {
    expect(bpmCost(120, 122)).toBeLessThan(bpmCost(120, 126));
  });
});

describe('targetEnergy', () => {
  it('holds the seed for a flat curve', () => {
    for (const position of [0, 0.5, 1]) {
      expect(targetEnergy('flat', position, 0.4)).toBe(0.4);
    }
  });

  it('rises and falls monotonically for build and wind down', () => {
    expect(targetEnergy('rise', 0, 0.3)).toBeLessThan(targetEnergy('rise', 1, 0.3));
    expect(targetEnergy('winddown', 0, 0.7)).toBeGreaterThan(targetEnergy('winddown', 1, 0.7));
  });

  it('peaks in the middle for an arc and returns near the seed by the end', () => {
    const seed = 0.4;
    const middle = targetEnergy('arc', 0.5, seed);
    expect(middle).toBeGreaterThan(targetEnergy('arc', 0, seed));
    expect(middle).toBeGreaterThan(targetEnergy('arc', 1, seed));
    expect(targetEnergy('arc', 1, seed)).toBeCloseTo(seed, 6);
  });

  it('stays inside 0..1 for every shape and every seed', () => {
    for (const shape of ['flat', 'rise', 'arc', 'winddown'] as const) {
      for (const seed of [0, 0.5, 1]) {
        for (let position = 0; position <= 1; position += 0.1) {
          const value = targetEnergy(shape, position, seed);
          expect(value).toBeGreaterThanOrEqual(0);
          expect(value).toBeLessThanOrEqual(1);
        }
      }
    }
  });
});

describe('weightsForCoherence', () => {
  it('keeps the total weight constant so costs stay comparable', () => {
    const baseTotal = Object.values(DEFAULT_WEIGHTS).reduce((a, b) => a + b, 0);
    for (const coherence of [0, 0.25, 0.5, 0.75, 1]) {
      const total = Object.values(weightsForCoherence(coherence)).reduce((a, b) => a + b, 0);
      expect(total).toBeCloseTo(baseTotal, 6);
    }
  });

  it('leaves the defaults alone in the middle', () => {
    expect(weightsForCoherence(0.5)).toEqual(DEFAULT_WEIGHTS);
  });

  it('moves weight onto tempo and key as coherence rises', () => {
    const loose = weightsForCoherence(0.1);
    const tight = weightsForCoherence(0.9);
    expect(tight.bpm).toBeGreaterThan(loose.bpm);
    expect(tight.key).toBeGreaterThan(loose.key);
    expect(tight.energy).toBeLessThan(loose.energy);
  });

  it('falls back to the base weights at the degenerate ends', () => {
    expect(weightsForCoherence(0).bpm).toBe(0);
    expect(weightsForCoherence(1).energy).toBe(0);
  });
});

describe('noveltyCost', () => {
  const target = { familiarity: 0.5 };

  it('is only the familiarity distance when nothing repeats', () => {
    const track = makeTrack({ id: 'a' });
    expect(noveltyCost(track, target, emptyContext())).toBeCloseTo(0, 6);
  });

  it('charges for a repeated artist, a repeated album and a recent play', () => {
    const track = makeTrack({ id: 'a', artist: 'Aphex Twin', album: 'Selected Ambient Works' });
    const context = {
      ...emptyContext(),
      recentArtists: ['Aphex Twin'],
      recentAlbums: ['Selected Ambient Works'],
      playedRecently: () => true,
    };
    expect(noveltyCost(track, target, context)).toBeCloseTo(0.6 + 0.3 + 1, 6);
  });

  it('follows the familiarity slider', () => {
    const track = makeTrack({ id: 'a' });
    const wellWorn = { ...emptyContext(), playFrequency: () => 1 };
    expect(noveltyCost(track, { familiarity: 1 }, wellWorn)).toBeLessThan(
      noveltyCost(track, { familiarity: 0 }, wellWorn),
    );
  });

  it('does not charge for a missing artist or album', () => {
    const track = makeTrack({ id: 'a', artist: null, album: null });
    const context = { ...emptyContext(), recentArtists: [''], recentAlbums: [''] };
    expect(noveltyCost(track, target, context)).toBeCloseTo(0, 6);
  });
});

describe('scoreCandidate', () => {
  const current = makeTrack({ id: 'current', bpm: 124, root: 'C', scale: 'major', energy: 0.5 });

  it('refuses a track with no analysis', () => {
    const candidate = makeTrack({ id: 'x', analysed: false });
    expect(scoreCandidate(current, candidate, { ...NEUTRAL_TARGET }, emptyContext())).toBe(
      Infinity,
    );
  });

  it('prefers the same key over a clashing one, all else equal', () => {
    const sameKey = makeTrack({ id: 'same', bpm: 124, root: 'C', scale: 'major' });
    const clash = makeTrack({ id: 'clash', bpm: 124, root: 'F#', scale: 'major' });
    const target = { ...NEUTRAL_TARGET };
    expect(scoreCandidate(current, sameKey, target, emptyContext())).toBeLessThan(
      scoreCandidate(current, clash, target, emptyContext()),
    );
  });

  it('prefers a track at the target energy', () => {
    const target = { ...NEUTRAL_TARGET, energy: 0.9 };
    const high = makeTrack({ id: 'high', bpm: 124, energy: 0.9 });
    const low = makeTrack({ id: 'low', bpm: 124, energy: 0.2 });
    expect(scoreCandidate(current, high, target, emptyContext())).toBeLessThan(
      scoreCandidate(current, low, target, emptyContext()),
    );
  });

  it('softens the tempo term when a tempo is not trustworthy', () => {
    // A badly mismatched tempo that nobody is sure about should cost less than the
    // same mismatch measured confidently.
    const target = { ...NEUTRAL_TARGET };
    const confident = makeTrack({ id: 'a', bpm: 200, bpmConfidence: 1 });
    const unsure = makeTrack({ id: 'b', bpm: 200, bpmConfidence: 0.1 });
    expect(scoreCandidate(current, unsure, target, emptyContext())).toBeLessThan(
      scoreCandidate(current, confident, target, emptyContext()),
    );
  });
});
