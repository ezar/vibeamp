/**
 * Queue planning.
 *
 * Given a seed and a vibe target, pick the next few tracks. Two properties matter
 * more than the scoring itself:
 *
 * - **What is playing is never touched.** Re-planning only ever rewrites from the
 *   next track onwards, so moving a slider can never interrupt the music.
 * - **The same seed does not always give the same session.** The winner is drawn
 *   from the best handful with a weighted roll rather than taken outright, so the
 *   feature survives being used twice.
 */

import type { EnergyShape, Track, VibeTarget } from '@vibeamp/core';
import { targetEnergy } from './energyCurve.js';
import {
  DEFAULT_WEIGHTS,
  relativeBpmDistance,
  scoreCandidate,
  weightsForCoherence,
} from './scoring.js';
import type { QueueContext, ScoreWeights } from './scoring.js';

/** How many of the best candidates the weighted roll draws from. */
export const SHORTLIST_SIZE = 12;

/**
 * Analysed tracks below which the auto-DJ refuses to run.
 *
 * A recommender with too little to go on produces obviously bad queues, and the
 * user concludes the feature does not work rather than that it is not ready. The
 * UI shows analysis progress in its place.
 */
export const MIN_ANALYSED_TRACKS = 30;

/** Relative BPM window used to prefilter a large library before scoring. */
const BPM_PREFILTER = 0.15;
/** Library size above which the prefilter is worth its complexity. */
const PREFILTER_THRESHOLD = 2000;

export interface PlanOptions {
  /** The track to continue from. */
  seed: Track;
  /**
   * Where the energy curve starts, 0..1, when the caller wants something other
   * than `target.energy`.
   *
   * Rarely needed. `target.energy` is the authority, because it is what the slider
   * sets; the UI initialises that slider from the playing track, so leaving this
   * alone already means "carry on from here".
   */
  baseEnergy?: number;
  /** Every track that could be queued. Unanalysed ones are filtered out. */
  candidates: readonly Track[];
  target: VibeTarget;
  shape: EnergyShape;
  context: QueueContext;
  /** How many tracks to plan. */
  length: number;
  /** Tracks already queued, which must not be picked again. */
  exclude?: Iterable<string>;
  /** Injected for tests; defaults to `Math.random`. */
  random?: () => number;
  weights?: ScoreWeights;
}

export interface PlannedTrack {
  track: Track;
  /** The cost that won it its place, for the debug panel. */
  cost: number;
  /** The energy the curve asked for at this position, 0..1. */
  targetEnergy: number;
}

/** Whether there is enough analysed material for the auto-DJ to be worth running. */
export function canAutoDj(candidates: readonly Track[]): boolean {
  let analysed = 0;
  for (const track of candidates) {
    if (track.status === 'done' && track.analysis !== null) {
      analysed++;
      if (analysed >= MIN_ANALYSED_TRACKS) return true;
    }
  }
  return false;
}

/**
 * Plan the next `length` tracks after `seed`.
 *
 * Returns fewer than asked for, including none, when the library runs out of
 * candidates. The caller shows what it got.
 */
export function planQueue(options: PlanOptions): PlannedTrack[] {
  const { seed, candidates, target, shape, context, length } = options;
  const random = options.random ?? Math.random;
  const weights = options.weights ?? weightsForCoherence(target.coherence, DEFAULT_WEIGHTS);

  const used = new Set<string>(options.exclude ?? []);
  used.add(seed.id);

  const pool = candidates.filter((track) => track.status === 'done' && track.analysis !== null);
  // The curve starts where the sliders say, not where the seed happens to be.
  // Reading it off the seed instead makes the energy slider inert for a flat curve,
  // which is the shape it is most often used with.
  const baseEnergy = options.baseEnergy ?? target.energy;

  const planned: PlannedTrack[] = [];
  let current = seed;

  for (let step = 0; step < length; step++) {
    // Position along the curve, so that a 20 track queue traverses the whole shape.
    const position = length <= 1 ? 0 : (step + 1) / length;
    const energy = targetEnergy(shape, position, baseEnergy);
    const stepTarget = { ...target, energy };

    const shortlist = shortlistFor(current, pool, used, stepTarget, context, weights);
    if (shortlist.length === 0) break;

    const chosen = drawWeighted(shortlist, random);
    used.add(chosen.track.id);
    planned.push({ track: chosen.track, cost: chosen.cost, targetEnergy: energy });
    current = chosen.track;
  }

  return planned;
}

interface Scored {
  track: Track;
  cost: number;
}

/** The best {@link SHORTLIST_SIZE} candidates for one step, cheapest first. */
function shortlistFor(
  current: Track,
  pool: readonly Track[],
  used: ReadonlySet<string>,
  target: VibeTarget & { energy: number },
  context: QueueContext,
  weights: ScoreWeights,
): Scored[] {
  const considered = prefilter(current, pool, used);

  // A partial selection rather than a sort: with 20,000 candidates, sorting the
  // whole array to read twelve entries is most of the time budget.
  const best: Scored[] = [];
  let worstKept = Infinity;

  for (const track of considered) {
    const cost = scoreCandidate(current, track, target, context, weights);
    if (!Number.isFinite(cost)) continue;
    if (best.length >= SHORTLIST_SIZE && cost >= worstKept) continue;

    best.push({ track, cost });
    best.sort((a, b) => a.cost - b.cost);
    if (best.length > SHORTLIST_SIZE) best.pop();
    worstKept = best[best.length - 1]?.cost ?? Infinity;
  }

  return best;
}

/**
 * Narrow a large library by tempo before scoring it.
 *
 * Only worth doing above {@link PREFILTER_THRESHOLD} tracks, and it falls back to
 * the whole pool when the window is too tight to fill a shortlist, so a library
 * with an unusual tempo spread still gets a queue.
 */
function prefilter(
  current: Track,
  pool: readonly Track[],
  used: ReadonlySet<string>,
): readonly Track[] {
  const available = pool.filter((track) => !used.has(track.id));
  if (available.length < PREFILTER_THRESHOLD) return available;

  const currentBpm = current.analysis?.bpm ?? 0;
  if (currentBpm <= 0) return available;

  const near = available.filter((track) => {
    const bpm = track.analysis?.bpm ?? 0;
    return bpm > 0 && relativeBpmDistance(currentBpm, bpm) <= BPM_PREFILTER;
  });
  return near.length >= SHORTLIST_SIZE ? near : available;
}

/**
 * Draw from the shortlist with probability proportional to `1 / (cost + 0.05)`.
 *
 * The offset keeps a zero-cost candidate from taking all the probability, which
 * would make the pick deterministic again.
 */
function drawWeighted(shortlist: readonly Scored[], random: () => number): Scored {
  let total = 0;
  for (const entry of shortlist) total += 1 / (entry.cost + 0.05);

  let roll = random() * total;
  for (const entry of shortlist) {
    roll -= 1 / (entry.cost + 0.05);
    if (roll <= 0) return entry;
  }
  // Floating point can leave a sliver; the best candidate is the right fallback.
  return shortlist[0] as Scored;
}
