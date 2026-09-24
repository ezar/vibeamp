/**
 * Getting from one record to another.
 *
 * What a route has to be is not "optimal" — there are astronomically many and no
 * listener could tell the best from the tenth best. It has to *arrive*, it has to
 * go somewhere on the way rather than jumping, and every move in it has to be one
 * the planner would have been willing to make anyway. Those are the three things
 * tested here.
 */

import { describe, expect, it } from 'vitest';
import { planJourney } from '../journey.js';
import { makeTrack } from './tracks.js';
import type { Track } from '@vibeamp/core';

/** A library spread evenly from slow and calm to fast and loud. */
function spread(count: number): Track[] {
  return Array.from({ length: count }, (_, index) => {
    const t = index / (count - 1);
    return makeTrack({
      id: `t${index}`,
      bpm: Math.round(70 + t * 100),
      energy: t,
      brightness: t,
      danceability: t,
      artist: `artist ${index % 7}`,
    });
  });
}

describe('planning a route', () => {
  const library = spread(60);
  const from = library[0];
  const to = library[library.length - 1];
  if (from === undefined || to === undefined) throw new Error('fixture');

  it('starts where it was told and ends where it was told', () => {
    const route = planJourney(from, to, library, { steps: 6 });
    expect(route).not.toBeNull();
    expect(route).toHaveLength(8);
    expect(route?.[0]?.track.id).toBe(from.id);
    expect(route?.at(-1)?.track.id).toBe(to.id);
    expect(route?.[0]?.progress).toBe(0);
    expect(route?.at(-1)?.progress).toBe(1);
  });

  it('goes somewhere on the way instead of jumping', () => {
    const route = planJourney(from, to, library, { steps: 6 });
    const energies = (route ?? []).map((step) => step.track.analysis?.energy ?? 0);

    // Every step moves towards the destination, and none of them is the leap the
    // whole feature exists to avoid. Seven moves across the library make an even
    // step 0.143; a quarter is comfortably above that and far below a jump.
    //
    // This is the assertion that caught both of the design's real mistakes: a
    // tempo cost that treats double time as a perfect match (the route leapt at
    // the third step, 0.73), and a destination pull too weak to beat it (it
    // dawdled among the first fifteen tracks and then leapt, 0.61).
    for (let i = 1; i < energies.length; i += 1) {
      const before = energies[i - 1] ?? 0;
      const after = energies[i] ?? 0;
      expect(after).toBeGreaterThan(before);
      expect(after - before).toBeLessThan(0.25);
    }
  });

  it('plays no record twice', () => {
    const route = planJourney(from, to, library, { steps: 10 });
    const ids = (route ?? []).map((step) => step.track.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('describes the move into every track but the first', () => {
    const route = planJourney(from, to, library, { steps: 4 });
    expect(route?.[0]?.transition).toBeNull();
    for (const step of (route ?? []).slice(1)) {
      expect(step.transition?.summary).toMatch(/bpm/);
    }
  });

  it('takes a longer route when asked for one, and a shorter one when not', () => {
    expect(planJourney(from, to, library, { steps: 2 })).toHaveLength(4);
    expect(planJourney(from, to, library, { steps: 12 })).toHaveLength(14);
  });

  it('leaves out what it was told to leave out', () => {
    const exclude = new Set(library.slice(10, 50).map((track) => track.id));
    const route = planJourney(from, to, library, { steps: 3, exclude });
    for (const step of (route ?? []).slice(1, -1)) {
      expect(exclude.has(step.track.id)).toBe(false);
    }
  });
});

describe('refusing to plan one', () => {
  it('says no rather than arriving somewhere else', () => {
    const library = spread(20);
    const from = library[0];
    const to = library[19];
    if (from === undefined || to === undefined) throw new Error('fixture');

    // A journey that does not arrive is not a journey, so too few tracks to make
    // one is a null and not a short route.
    expect(planJourney(from, to, library.slice(0, 3), { steps: 8 })).toBeNull();
    expect(planJourney(from, from, library, { steps: 4 })).toBeNull();
    expect(planJourney(makeTrack({ id: 'x', analysed: false }), to, library)).toBeNull();
    expect(planJourney(from, makeTrack({ id: 'y', analysed: false }), library)).toBeNull();
  });
});

describe('the moves it prefers', () => {
  it('avoids playing the same artist twice in a row where it can', () => {
    // Two identical routes are available; one repeats an artist at every step.
    const library: Track[] = [];
    for (let index = 0; index < 40; index += 1) {
      const t = index / 39;
      library.push(
        makeTrack({
          id: `same-${index}`,
          bpm: Math.round(70 + t * 100),
          energy: t,
          brightness: t,
          danceability: t,
          artist: 'one artist',
        }),
        makeTrack({
          id: `varied-${index}`,
          bpm: Math.round(70 + t * 100),
          energy: t,
          brightness: t,
          danceability: t,
          artist: `artist ${index}`,
        }),
      );
    }
    const from = library[0];
    const to = library[library.length - 1];
    if (from === undefined || to === undefined) throw new Error('fixture');

    const route = planJourney(from, to, library, { steps: 6 }) ?? [];
    expect(route).toHaveLength(8);
    // Consecutive is what costs: a route that alternates between the two artists
    // is as good as one that never touches the repeated one, and both are fine.
    for (let i = 1; i < route.length; i += 1) {
      const before = route[i - 1]?.track.meta.artist;
      const after = route[i]?.track.meta.artist;
      expect(after === before && after !== null).toBe(false);
    }
  });
});
