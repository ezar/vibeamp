import { describe, expect, it } from 'vitest';
import { MIN_ANALYSED_TRACKS, canAutoDj, planQueue } from '../queue.js';
import { relativeBpmDistance } from '../scoring.js';
import { NEUTRAL_TARGET, emptyContext, makeLibrary, makeTrack } from './tracks.js';
import { mulberry32 } from './random.js';

const BASE = {
  target: NEUTRAL_TARGET,
  shape: 'arc' as const,
  context: emptyContext(),
  length: 20,
};

describe('canAutoDj', () => {
  it('refuses a library with too little analysed', () => {
    expect(canAutoDj(makeLibrary(MIN_ANALYSED_TRACKS - 1))).toBe(false);
    expect(canAutoDj(makeLibrary(MIN_ANALYSED_TRACKS))).toBe(true);
  });

  it('does not count tracks that are only discovered', () => {
    const pending = Array.from({ length: 100 }, (_, i) =>
      makeTrack({ id: `p${i}`, analysed: false }),
    );
    expect(canAutoDj(pending)).toBe(false);
  });
});

describe('planQueue', () => {
  it('plans the requested number of tracks', () => {
    const library = makeLibrary(500);
    const seed = library[0]!;
    const planned = planQueue({ ...BASE, seed, candidates: library, random: mulberry32(1) });
    expect(planned).toHaveLength(20);
  });

  it('never repeats a track and never queues the seed', () => {
    const library = makeLibrary(500);
    const seed = library[0]!;
    const planned = planQueue({ ...BASE, seed, candidates: library, random: mulberry32(2) });
    const ids = planned.map((entry) => entry.track.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain(seed.id);
  });

  it('honours the exclusion list, so re-planning cannot duplicate what is queued', () => {
    const library = makeLibrary(300);
    const seed = library[0]!;
    const exclude = library.slice(1, 50).map((track) => track.id);
    const planned = planQueue({
      ...BASE,
      seed,
      candidates: library,
      exclude,
      random: mulberry32(3),
    });
    for (const entry of planned) expect(exclude).not.toContain(entry.track.id);
  });

  it('skips tracks with no analysis', () => {
    const analysed = makeLibrary(60);
    const unanalysed = Array.from({ length: 200 }, (_, i) =>
      makeTrack({ id: `u${i}`, analysed: false }),
    );
    const planned = planQueue({
      ...BASE,
      seed: analysed[0]!,
      candidates: [...analysed, ...unanalysed],
      random: mulberry32(4),
    });
    for (const entry of planned) expect(entry.track.id.startsWith('u')).toBe(false);
  });

  it('returns what it can when the library runs out, rather than throwing', () => {
    const library = makeLibrary(5);
    const planned = planQueue({
      ...BASE,
      seed: library[0]!,
      candidates: library,
      random: mulberry32(5),
    });
    expect(planned.length).toBe(4);
  });

  it('returns nothing when there is nothing to queue', () => {
    const seed = makeTrack({ id: 'only' });
    expect(planQueue({ ...BASE, seed, candidates: [seed], random: mulberry32(6) })).toEqual([]);
  });

  it('is reproducible from a seeded generator and varies between seeds', () => {
    const library = makeLibrary(400);
    const seed = library[0]!;
    const ids = (n: number) =>
      planQueue({ ...BASE, seed, candidates: library, random: mulberry32(n) }).map(
        (entry) => entry.track.id,
      );

    expect(ids(7)).toEqual(ids(7));
    // The whole point of the weighted draw: the same seed twice is not the same set.
    expect(ids(7)).not.toEqual(ids(8));
  });

  it('follows the energy curve it was given', () => {
    const library = makeLibrary(800);
    const seed = makeTrack({ id: 'seed', energy: 0.2, bpm: 120 });
    const rising = planQueue({
      ...BASE,
      shape: 'rise',
      seed,
      candidates: library,
      random: mulberry32(9),
    });

    const firstHalf = rising.slice(0, 10);
    const secondHalf = rising.slice(10);
    const mean = (entries: typeof rising) =>
      entries.reduce((sum, entry) => sum + entry.track.analysis!.energy, 0) / entries.length;
    expect(mean(secondHalf)).toBeGreaterThan(mean(firstHalf));
  });

  it('reorders the queue when the energy slider moves', () => {
    // Acceptance criterion: moving energy to the top must change what is queued, not
    // just what the numbers say.
    const library = makeLibrary(600);
    const seed = library[0]!;
    const calm = planQueue({
      ...BASE,
      shape: 'flat',
      seed,
      target: { ...NEUTRAL_TARGET, energy: 0.05 },
      candidates: library,
      random: mulberry32(11),
    });
    const intense = planQueue({
      ...BASE,
      shape: 'flat',
      seed,
      target: { ...NEUTRAL_TARGET, energy: 0.95 },
      candidates: library,
      random: mulberry32(11),
    });

    const meanEnergy = (entries: typeof calm) =>
      entries.reduce((sum, entry) => sum + entry.track.analysis!.energy, 0) / entries.length;
    expect(meanEnergy(intense)).toBeGreaterThan(meanEnergy(calm) + 0.3);
  });

  it('keeps consecutive tempos close in at least 80 per cent of transitions', () => {
    // Acceptance criterion, measured over several sessions so it is not one lucky
    // draw. A queue that jumps tempo is the thing a listener notices first.
    const library = makeLibrary(1500, 99);
    let close = 0;
    let total = 0;

    for (let run = 0; run < 10; run++) {
      const seed = library[run * 37]!;
      const planned = planQueue({
        ...BASE,
        seed,
        candidates: library,
        target: { ...NEUTRAL_TARGET, coherence: 0.7 },
        random: mulberry32(100 + run),
      });
      let previous = seed;
      for (const entry of planned) {
        total++;
        if (relativeBpmDistance(previous.analysis!.bpm, entry.track.analysis!.bpm) < 0.1) close++;
        previous = entry.track;
      }
    }

    expect(close / total).toBeGreaterThanOrEqual(0.8);
  });

  it('plans 20 tracks from 20,000 candidates well inside the budget', () => {
    // Acceptance criterion: under 100 ms. Timed loosely with a millisecond clock,
    // because a CI runner is not a benchmark: the point is to catch an accidental
    // quadratic, not to measure the real figure.
    const library = makeLibrary(20000, 7);
    const started = Date.now();
    const planned = planQueue({
      ...BASE,
      seed: library[0]!,
      candidates: library,
      random: mulberry32(13),
    });
    const elapsed = Date.now() - started;

    expect(planned).toHaveLength(20);
    expect(elapsed).toBeLessThan(500);
  });
});
