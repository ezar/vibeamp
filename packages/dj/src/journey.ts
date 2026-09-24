/**
 * Getting from one record to another.
 *
 * The auto-DJ answers "what next", which is the question a radio asks. This answers
 * the other one, the question a DJ asks: *how do I get from here to there*. You
 * name where you are and where you want to end up — an ambient piece and a techno
 * track, a ballad and a stomper — and this lays out the records in between, each
 * step a move the planner would already have been willing to make.
 *
 * It needs a collection somebody has listened to. A service knows what its
 * catalogue is filed under; it does not know that these two records are four
 * moves apart, because nothing it stores is a distance.
 *
 * The search is a beam rather than a greedy walk. Greedy gets a long way and then
 * finds it has nothing left within reach, which on a real library happens often
 * enough to matter; keeping a handful of partial routes alive costs almost nothing
 * and nearly always finds a way through. It is not an optimal path and does not
 * claim to be: the point is a defensible route, not the best of the astronomically
 * many.
 */

import { camelotDistance } from '@vibeamp/core';
import type { Track } from '@vibeamp/core';
import { explainTransition } from './explain.js';
import type { Transition } from './explain.js';
import { BPM_TOLERANCE, keyReliability } from './scoring.js';

/** Tracks between the two ends, unless asked for otherwise. */
export const DEFAULT_JOURNEY_STEPS = 6;

/** Partial routes kept alive at each step. */
const BEAM_WIDTH = 8;

/**
 * Candidates considered at each step.
 *
 * The nearest this many to where the journey should be at that point, which turns
 * a pass over the whole library into a pass plus a small search. A wider shortlist
 * buys nothing: a track that is nowhere near where this step should be is not
 * going to win on transition cost alone.
 */
const SHORTLIST = 150;

/**
 * How hard a step is pulled towards where the journey should be by then.
 *
 * Measured rather than chosen. At 0.9 the two terms are within a rounding error of
 * each other, and the route exploits it: on a library spread evenly from 70 to 170
 * BPM it dawdled among the first fifteen tracks — where every move is nearly free —
 * and then leapt the whole rest of the distance in one step, which is precisely
 * what it was asked not to do. Dawdling and leaping are the same failure seen from
 * the two ends.
 *
 * At 2.5 the pull decides *where* each step should be and the transition cost
 * decides *which* of the tracks near there to use, which is the division of labour
 * this wants. Note that the pull is towards the interpolated point for that step,
 * never towards the destination itself: a strong pull therefore means "be where
 * the journey says you should be", not "arrive early".
 */
const PULL = 2.5;

/** Cost added for playing the same artist twice in a row. */
const SAME_ARTIST = 0.4;

/**
 * How much of the per-step tempo budget a move may use before it costs anything.
 *
 * Half as much again as the average step. A route that has to cross a hundred BPM
 * in seven moves cannot make every move a small one, and scoring each of them as a
 * mismatch would make the tempo term say nothing at all.
 */
const TEMPO_SLACK = 1.5;

export interface JourneyStep {
  track: Track;
  /** The move into this track. Null for the first, which nothing leads into. */
  transition: Transition | null;
  /** How far along the route this step is, 0 at the start and 1 at the end. */
  progress: number;
}

export interface JourneyOptions {
  /** Tracks between the two ends. */
  steps?: number;
  /** Tracks that may not appear in the middle, by id. */
  exclude?: ReadonlySet<string>;
}

/**
 * Lay out a route from one track to another.
 *
 * @returns The whole route, `from` first and `to` last, or null when there is not
 *   enough analysed music between them to make one. Null rather than a short route:
 *   a journey that does not arrive is not a journey.
 */
export function planJourney(
  from: Track,
  to: Track,
  library: readonly Track[],
  options: JourneyOptions = {},
): JourneyStep[] | null {
  const steps = Math.max(1, Math.round(options.steps ?? DEFAULT_JOURNEY_STEPS));
  if (from.analysis === null || to.analysis === null || from.id === to.id) return null;

  const exclude = options.exclude ?? new Set<string>();
  const pool = library.filter(
    (track) =>
      track.analysis !== null &&
      track.id !== from.id &&
      track.id !== to.id &&
      !exclude.has(track.id),
  );
  if (pool.length < steps) return null;

  // What a single move is expected to change the tempo by, as a fraction. A
  // journey is allowed to change tempo — that is what it is for — but only at the
  // rate the journey needs, and this is that rate.
  const tolerance = tempoTolerance(from, to, steps);

  let routes: Route[] = [{ tracks: [from], used: new Set([from.id]), cost: 0 }];

  for (let step = 1; step <= steps; step += 1) {
    const target = between(from, to, step / (steps + 1));
    const shortlist = nearest(pool, target, SHORTLIST);

    const next: Route[] = [];
    for (const route of routes) {
      const last = route.tracks[route.tracks.length - 1];
      if (last === undefined) continue;
      for (const candidate of shortlist) {
        if (route.used.has(candidate.id)) continue;
        const cost =
          route.cost + stepCost(last, candidate, tolerance) + PULL * distanceTo(candidate, target);
        next.push({
          tracks: [...route.tracks, candidate],
          used: new Set([...route.used, candidate.id]),
          cost,
        });
      }
    }
    if (next.length === 0) return null;

    next.sort((a, b) => a.cost - b.cost);
    routes = prune(next, BEAM_WIDTH);
  }

  // The last move is the one that has to land, so it is scored like any other and
  // the route that arrives best wins.
  let best: Route | null = null;
  for (const route of routes) {
    const last = route.tracks[route.tracks.length - 1];
    if (last === undefined) continue;
    const cost = route.cost + stepCost(last, to, tolerance);
    if (best === null || cost < best.cost) {
      best = { tracks: [...route.tracks, to], used: route.used, cost };
    }
  }
  if (best === null) return null;

  return best.tracks.map((track, index) => {
    const previous = index === 0 ? null : (best.tracks[index - 1] ?? null);
    return {
      track,
      transition: previous === null ? null : explainTransition(previous, track),
      progress: index / (best.tracks.length - 1),
    };
  });
}

/** A partial route through the library. */
interface Route {
  tracks: Track[];
  used: Set<string>;
  cost: number;
}

/**
 * Keep the best routes, at most one per last track.
 *
 * Without that rule a beam fills up with eight variations on the same tail, which
 * is one route and seven copies of it — and the whole reason for keeping several is
 * that they should be able to fail differently.
 */
function prune(routes: readonly Route[], width: number): Route[] {
  const kept: Route[] = [];
  const seen = new Set<string>();
  for (const route of routes) {
    const last = route.tracks[route.tracks.length - 1];
    if (last === undefined || seen.has(last.id)) continue;
    seen.add(last.id);
    kept.push(route);
    if (kept.length >= width) break;
  }
  return kept;
}

/** Where a journey should be, as a point among the descriptors, at `t` of the way. */
interface Point {
  energy: number;
  brightness: number;
  danceability: number;
  /** Tempo, scaled so a step of one is the whole range the library spans. */
  tempo: number;
}

/** Tempo in the same units as the other descriptors: 60 BPM is 0, 200 is 1. */
function scaleTempo(bpm: number): number {
  if (!(bpm > 0)) return 0.5;
  return Math.min(1, Math.max(0, (bpm - 60) / 140));
}

function pointOf(track: Track): Point {
  const analysis = track.analysis;
  if (analysis === null) return { energy: 0.5, brightness: 0.5, danceability: 0.5, tempo: 0.5 };
  return {
    energy: analysis.energy,
    brightness: analysis.brightness,
    danceability: analysis.danceability,
    tempo: scaleTempo(analysis.bpm),
  };
}

/** The point `t` of the way from one track to another. */
function between(from: Track, to: Track, t: number): Point {
  const a = pointOf(from);
  const b = pointOf(to);
  const mix = (one: number, other: number): number => one + (other - one) * t;
  return {
    energy: mix(a.energy, b.energy),
    brightness: mix(a.brightness, b.brightness),
    danceability: mix(a.danceability, b.danceability),
    tempo: mix(a.tempo, b.tempo),
  };
}

/** How far a track is from where the journey should be, 0..1-ish. */
function distanceTo(track: Track, target: Point): number {
  const point = pointOf(track);
  return (
    (Math.abs(point.energy - target.energy) +
      Math.abs(point.brightness - target.brightness) +
      Math.abs(point.danceability - target.danceability) +
      Math.abs(point.tempo - target.tempo)) /
    4
  );
}

/** The `count` tracks closest to a point, nearest first. */
function nearest(pool: readonly Track[], target: Point, count: number): Track[] {
  return [...pool]
    .map((track) => ({ track, distance: distanceTo(track, target) }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, count)
    .map((entry) => entry.track);
}

/**
 * What it costs to play one track after another.
 *
 * The same two things the queue weighs — tempo and the wheel — with the same
 * treatment of an estimate nobody should trust: faded towards neutral rather than
 * believed or discarded. No vibe target and no play history, because a journey is
 * about the route and not about the listener's mood or what they heard this
 * morning.
 */
function stepCost(from: Track, to: Track, tolerance: number): number {
  const a = from.analysis;
  const b = to.analysis;
  if (a === null || b === null) return Infinity;

  const tempoConfidence = Math.min(a.bpmConfidence, b.bpmConfidence);
  const tempo = tempoStep(a.bpm, b.bpm, tolerance) * tempoConfidence + 0.5 * (1 - tempoConfidence);

  const keyConfidence = Math.min(keyReliability(a.key.strength), keyReliability(b.key.strength));
  const key =
    camelotDistance(a.key.camelot, b.key.camelot) * keyConfidence + 0.5 * (1 - keyConfidence);

  const artist = from.meta.artist !== null && from.meta.artist === to.meta.artist ? SAME_ARTIST : 0;

  return 0.55 * tempo + 0.45 * key + artist;
}

/**
 * The tempo change one move of this journey is expected to make, as a fraction.
 *
 * Never below the queue's own tolerance: a journey between two tracks at the same
 * tempo still has a budget, and it is the ordinary one.
 */
function tempoTolerance(from: Track, to: Track, steps: number): number {
  const fromBpm = from.analysis?.bpm ?? 0;
  const toBpm = to.analysis?.bpm ?? 0;
  if (!(fromBpm > 0) || !(toBpm > 0)) return BPM_TOLERANCE;
  const perStep = Math.abs(toBpm - fromBpm) / (steps + 1) / fromBpm;
  return Math.max(BPM_TOLERANCE, perStep * TEMPO_SLACK);
}

/**
 * Tempo cost of one move of a journey, 0..1.
 *
 * Deliberately *not* the queue's `bpmCost`, which treats half and double time as a
 * perfect match. That is right for a queue, where what matters is that the pulse
 * carries over; it is exactly wrong here, because a free octave is a free jump —
 * measured on a library spread evenly from 70 to 170 BPM, a route offered a
 * double-time leap took it at the third step and skipped the entire middle of the
 * collection, which is the one thing a journey must not do.
 */
function tempoStep(fromBpm: number, toBpm: number, tolerance: number): number {
  if (!(fromBpm > 0) || !(toBpm > 0)) return 0.5;
  return Math.min(1, Math.abs(toBpm - fromBpm) / fromBpm / tolerance);
}
