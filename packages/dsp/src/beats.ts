/**
 * Where the beats actually fall.
 *
 * The tempo estimator answers "how often", which is all a queue needs: to know
 * that two tracks sit at the same pace you need no idea where either of their
 * beats is. Playing one *into* the other is a different question, and it is the
 * one every DJ asks first — not how fast, but *when*.
 *
 * So this takes the tempo as given and finds the phase: the offset, inside one
 * beat period, at which a grid of beats lines up best with the onsets. A single
 * pass over the envelope per candidate offset, which is cheap because the tempo
 * has already narrowed it to one period.
 *
 * What it deliberately does not find is the *downbeat* — which of every four beats
 * starts the bar. That is a genuinely harder problem than this, it is wrong often
 * enough on real music to matter, and being wrong about it is worse than not
 * asking: a fade deliberately started half a bar out is more obviously wrong than
 * one that merely does not know where the bar is. See `align.ts`.
 */

import type { OnsetEnvelope } from './onset.js';

/** Slowest tempo a grid is looked for at. Below this the phase means little. */
const MIN_GRID_BPM = 50;
/** Fastest, for the same reason. */
const MAX_GRID_BPM = 210;

/**
 * Offsets tried inside one beat period.
 *
 * Thirty-two, so the phase lands within about one and a half percent of a beat —
 * five milliseconds at 120 BPM, which is far below anything anyone hears as early
 * or late. Searching at whole envelope frames would be coarser than that at fast
 * tempos, and the envelope is interpolated between frames anyway.
 */
const PHASE_STEPS = 32;

/**
 * Grid strength below which the phase is not worth acting on.
 *
 * Measured. Through the real envelope, a kick on every beat scores 0.84 to 0.89,
 * and twelve seconds of white noise — where nothing starts anywhere, so no offset
 * can genuinely beat any other — still scores 0.21, because the best of
 * thirty-two noisy candidates always beats the average of them. Four tenths sits
 * between the two with room on both sides. `beats.test.ts` keeps both numbers
 * honest.
 */
export const MIN_GRID_STRENGTH = 0.4;

export interface BeatGrid {
  /**
   * When a beat falls, in seconds from the start of the analysed signal.
   *
   * Always inside the first beat period: every other beat is this plus a whole
   * number of periods, so one number describes the whole grid.
   */
  phaseSec: number;
  /** The period the grid was built on, in seconds. */
  periodSec: number;
  /**
   * How much the onsets agree with the grid, 0..1.
   *
   * 0 when the envelope is as strong between the beats as on them, which is what
   * music without a pulse looks like and what a tempo estimate on such music is
   * worth. Approaching 1 when the energy sits entirely on the grid.
   */
  strength: number;
}

/**
 * Find where the beats fall, given how often they fall.
 *
 * @param envelope The onset envelope of the stretch to measure. The phase is
 *   relative to the start of *that stretch*, so a caller measuring the end of a
 *   track has to add the offset it cut at.
 * @param bpm The tempo, from the estimator.
 * @returns Null when there is no usable tempo, or when the envelope is too short to
 *   hold several beats — two or three beats is not a grid, it is a coincidence.
 */
export function beatGrid(envelope: OnsetEnvelope, bpm: number): BeatGrid | null {
  const { strength, rate } = envelope;
  if (!Number.isFinite(bpm) || bpm < MIN_GRID_BPM || bpm > MAX_GRID_BPM) return null;

  const period = (60 * rate) / bpm;
  const beats = Math.floor(strength.length / period);
  if (beats < 4) return null;

  let mean = 0;
  for (let i = 0; i < strength.length; i += 1) mean += strength[i] ?? 0;
  mean /= strength.length;
  if (!(mean > 0)) return null;

  let bestPhase = 0;
  let bestScore = -Infinity;
  let bestHits = 0;
  let totalScore = 0;
  for (let step = 0; step < PHASE_STEPS; step += 1) {
    const phase = (step / PHASE_STEPS) * period;
    const { score, hits } = onGrid(strength, phase, period, beats, mean);
    totalScore += score;
    if (score > bestScore) {
      bestScore = score;
      bestPhase = phase;
      bestHits = hits;
    }
  }

  const average = totalScore / PHASE_STEPS;
  if (!(average > 0) || !Number.isFinite(bestScore)) return null;

  // The envelope runs ahead of the audio by a fixed amount, so a phase read off it
  // is early by the same amount. Corrected here rather than by the caller: every
  // caller would have to do it, and forgetting is a tenth of a beat.
  const periodSec = 60 / bpm;
  const corrected = bestPhase / rate + envelope.leadSec;

  return {
    // Back into the first period, which is where a phase lives by definition.
    phaseSec: ((corrected % periodSec) + periodSec) % periodSec,
    periodSec,
    strength: gridStrength(bestScore, average, bestHits, beats),
  };
}

/**
 * How much to trust a grid, 0..1.
 *
 * Two things, multiplied, because either on its own is fooled:
 *
 * - **How far the winning offset beat the average offset.** Measured against the
 *   other offsets rather than against a flat envelope, because the best of
 *   thirty-two noisy candidates beats a flat expectation on any signal at all —
 *   twelve seconds of white noise scores 0.21 that way.
 * - **How many of the beats landed on anything at all.** One onset — the first
 *   note of a held chord, with nothing after it — makes one offset win by a mile
 *   while thirty-nine of forty beats sit on silence. Without this that reads as a
 *   confident grid, which is how music with no pulse whatsoever ends up treated as
 *   music with a very clear one.
 */
function gridStrength(best: number, average: number, hits: number, beats: number): number {
  const margin = (best - average) / (best + average);
  const landed = beats === 0 ? 0 : hits / beats;
  return Math.max(0, Math.min(1, margin * landed));
}

/**
 * The envelope sampled at every beat of a grid: how much is there, and how much of
 * it is spread across the beats rather than piled on one of them.
 *
 * Linear interpolation between frames: a beat period is rarely a whole number of
 * frames, and rounding to the nearest one would make the score jump about as the
 * phase slides, which is exactly the quantity being maximised.
 */
function onGrid(
  strength: Float64Array,
  phase: number,
  period: number,
  beats: number,
  mean: number,
): { score: number; hits: number } {
  let score = 0;
  let hits = 0;
  for (let beat = 0; beat < beats; beat += 1) {
    const at = phase + beat * period;
    const low = Math.floor(at);
    const fraction = at - low;
    const first = strength[low] ?? 0;
    const second = strength[low + 1] ?? first;
    const value = first + (second - first) * fraction;
    score += value;
    // "Something happened here" rather than "a lot happened here": compared with
    // the envelope's own mean, so the count is about how many beats are accounted
    // for and not about how loud the loudest of them was.
    if (value > mean) hits += 1;
  }
  return { score, hits };
}
