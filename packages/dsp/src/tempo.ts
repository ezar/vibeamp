/**
 * Tempo estimation from an onset strength envelope.
 *
 * Autocorrelation of the envelope, scored with a harmonic comb so that a lag and
 * its multiples reinforce each other. Three things then decide between a tempo
 * and its octave, which is the one mistake that matters here: a queue built on a
 * track filed at half its real tempo puts a jump into every transition.
 *
 * - **Fractional lags.** The comb is evaluated at interpolated lags rather than
 *   whole envelope frames. At 100 frames per second, 174 BPM is a period of 34.48
 *   frames, and a comb restricted to integers lines up better with 69 (half the
 *   tempo, and nearly exact) than with 34. That alone reports half tempo.
 * - **A sub-multiple penalty.** If the envelope also correlates at half or a third
 *   of a candidate period, that candidate is the multiple of a faster pulse, and
 *   the faster pulse is the beat.
 * - **A log-normal prior** around 120 BPM, gentle enough to break a tie without
 *   overriding a clear peak. A track genuinely at 75 or at 174 is still reported
 *   there.
 */

import type { OnsetEnvelope } from './onset.js';

/** Slowest tempo the estimator will report, in beats per minute. */
export const MIN_BPM = 40;
/** Fastest tempo the estimator will report, in beats per minute. */
export const MAX_BPM = 220;
/** Step of the tempo search, in beats per minute. */
const SEARCH_STEP_BPM = 0.25;
/** Centre of the tempo prior, in beats per minute. */
const PRIOR_CENTRE_BPM = 120;
/** Width of the tempo prior, in octaves of tempo. */
const PRIOR_WIDTH_OCTAVES = 0.9;
/** How hard a candidate is penalised for having a strong sub-multiple. */
const SUB_MULTIPLE_WEIGHT = 0.7;
/** Relative weight of each harmonic of a candidate period in the comb. */
const HARMONIC_WEIGHTS = [1, 0.5, 0.33, 0.25] as const;
/** Envelope peakiness at or below which there are no onsets to speak of. */
const PEAKINESS_FLOOR = 3;
/** Envelope peakiness above which onsets are as clear as they are going to get. */
const PEAKINESS_CEILING = 15;

export interface TempoEstimate {
  /** Estimated tempo in beats per minute, or 0 when the envelope carries no pulse. */
  bpm: number;
  /**
   * How much to trust {@link bpm}, 0..1.
   *
   * The envelope's own autocorrelation at the winning period, scaled by how spiky
   * the envelope is in the first place. Both halves are needed. A held tone's
   * envelope is a clean periodic ripple and autocorrelates beautifully at a lag
   * that has nothing to do with music, so periodicity alone reports a confident
   * tempo for a drone; peakiness alone would trust an unsteady drummer as much as
   * a drum machine. Near 0 for speech, noise and ambient music, above 0.5 for
   * anything with a steady beat. The queue treats a low confidence tempo as
   * unusable rather than as wrong.
   */
  confidence: number;
}

/** Estimate tempo from an onset envelope. */
export function estimateTempo(envelope: OnsetEnvelope): TempoEstimate {
  const { strength, rate, peakiness } = envelope;
  const maxLag = Math.ceil((60 * rate) / MIN_BPM);

  // Two full periods of the slowest tempo are needed before the autocorrelation
  // at that lag means anything at all.
  if (strength.length < maxLag * 2) return { bpm: 0, confidence: 0 };

  const correlation = normalisedAutocorrelation(strength, maxLag);
  if (correlation === null) return { bpm: 0, confidence: 0 };

  let bestBpm = 0;
  let bestScore = -Infinity;
  let bestComb = 0;

  for (let bpm = MIN_BPM; bpm <= MAX_BPM; bpm += SEARCH_STEP_BPM) {
    const lag = (60 * rate) / bpm;
    const comb = combScore(correlation, lag, maxLag);
    const penalty = subMultipleStrength(correlation, lag);
    const score = (comb - SUB_MULTIPLE_WEIGHT * penalty) * tempoPrior(bpm);
    if (score > bestScore) {
      bestScore = score;
      bestBpm = bpm;
      bestComb = comb;
    }
  }

  if (bestBpm === 0 || bestComb <= 0) return { bpm: 0, confidence: 0 };

  const salience = clamp01((peakiness - PEAKINESS_FLOOR) / (PEAKINESS_CEILING - PEAKINESS_FLOOR));
  return { bpm: round(bestBpm, 2), confidence: round(clamp01(bestComb) * salience, 3) };
}

/**
 * Autocorrelation for lags 0..maxLag, divided by the value at lag 0.
 *
 * Biased (every lag divided by the full length, not by its overlap), which tapers
 * long lags. That taper is wanted: it is a mild, free discouragement of absurdly
 * slow tempos, and it keeps every value inside -1..1.
 *
 * @returns `null` when the envelope has no energy, which is what silence and an
 *   unmodulated tone both produce.
 */
function normalisedAutocorrelation(signal: Float64Array, maxLag: number): Float64Array | null {
  const n = signal.length;
  const out = new Float64Array(maxLag + 1);

  let energy = 0;
  for (let i = 0; i < n; i++) energy += signal[i] * signal[i];
  if (energy <= 0) return null;

  for (let lag = 0; lag <= maxLag; lag++) {
    let sum = 0;
    for (let i = 0; i + lag < n; i++) sum += signal[i] * signal[i + lag];
    out[lag] = sum / energy;
  }
  return out;
}

/** Linear interpolation of the correlation at a fractional lag. */
function correlationAt(correlation: Float64Array, lag: number): number {
  if (lag < 0) return 0;
  const lower = Math.floor(lag);
  if (lower >= correlation.length - 1) return correlation[correlation.length - 1] ?? 0;
  const fraction = lag - lower;
  return correlation[lower] * (1 - fraction) + correlation[lower + 1] * fraction;
}

/**
 * Weighted mean correlation at a candidate period and its first few multiples.
 *
 * A real pulse repeats, so the true beat period correlates at one, two, three and
 * four beats while a spurious peak does not. Later multiples are weighted down
 * because the taper has eaten more of them. The result is a mean rather than a
 * sum, so a candidate near the end of the search range is comparable with one in
 * the middle even though fewer of its harmonics fit.
 */
function combScore(correlation: Float64Array, lag: number, maxLag: number): number {
  let score = 0;
  let usedWeight = 0;
  for (let harmonic = 1; harmonic <= HARMONIC_WEIGHTS.length; harmonic++) {
    const at = lag * harmonic;
    if (at > maxLag) break;
    const weight = HARMONIC_WEIGHTS[harmonic - 1] ?? 0;
    score += weight * correlationAt(correlation, at);
    usedWeight += weight;
  }
  return usedWeight === 0 ? 0 : score / usedWeight;
}

/**
 * How strongly the envelope correlates at half and a third of a candidate period.
 *
 * High means there are beats in between the candidate's, so the candidate is a
 * multiple of the real pulse. This is what separates a genuine 87 BPM track from
 * a 174 BPM one filed at half tempo, which the comb alone cannot do: every
 * multiple of the true period scores well on a comb.
 */
function subMultipleStrength(correlation: Float64Array, lag: number): number {
  const half = correlationAt(correlation, lag / 2);
  const third = correlationAt(correlation, lag / 3);
  return Math.max(0, Math.max(half, third));
}

/**
 * Log-normal preference over tempo, peaking at {@link PRIOR_CENTRE_BPM}.
 *
 * Deliberately gentle. It breaks ties; it cannot overturn a clear peak.
 */
function tempoPrior(bpm: number): number {
  const octaves = Math.log2(bpm / PRIOR_CENTRE_BPM);
  return Math.exp(-0.5 * (octaves / PRIOR_WIDTH_OCTAVES) ** 2);
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
