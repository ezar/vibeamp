/**
 * Danceability proxy.
 *
 * This is **not** Essentia's `Danceability`, which uses detrended fluctuation
 * analysis over several time scales. It is a composite of three things that are
 * cheap to measure from what the pipeline already computed, and it is named a
 * proxy everywhere it appears:
 *
 * - **Pulse clarity.** How sharply the onset envelope autocorrelates at the beat
 *   period. A drum machine scores high, rubato piano scores low.
 * - **Low band weight.** How much of the energy is kick and bass.
 * - **Onset density.** How often something happens, normalised against a rate
 *   that feels busy rather than frantic.
 *
 * The three are multiplied rather than averaged, because a track needs all of them
 * to be danceable and an average lets one strong term carry a track that is not.
 */

import type { OnsetEnvelope } from './onset.js';

/** Onset rate treated as fully "busy", in onsets per second. */
const SATURATING_ONSET_RATE = 4;

export interface DanceabilityInputs {
  envelope: OnsetEnvelope;
  /** Tempo confidence from {@link estimateTempo}, 0..1. */
  pulseClarity: number;
  /** Mean low-band energy ratio over the window, 0..1. */
  lowBandRatio: number;
}

/**
 * Combine the three terms into a 0..1 proxy.
 *
 * The cube root pulls the product back onto a usable scale: three terms around
 * 0.5 should read as "moderately danceable", not as 0.125.
 */
export function danceabilityProxy({
  envelope,
  pulseClarity,
  lowBandRatio,
}: DanceabilityInputs): number {
  const density = onsetDensity(envelope);
  // Each term is floored well above zero so that one weak measurement cannot
  // collapse the product to nothing; a track with no bass is still danceable.
  const clarity = 0.2 + 0.8 * clamp01(pulseClarity);
  const weight = 0.4 + 0.6 * clamp01(lowBandRatio * 2);
  const busyness = 0.3 + 0.7 * clamp01(density / SATURATING_ONSET_RATE);
  return clamp01(Math.cbrt(clarity * weight * busyness));
}

/**
 * Onsets per second in the envelope, counted as local maxima that stand a standard
 * deviation above the mean.
 *
 * The threshold is what makes this a measure of onsets rather than of ripple. A
 * held tone produces an envelope that is numerically tiny but still wobbles, and a
 * peak counter that only asks "above the mean" reports a drone as the busiest
 * thing in the library.
 */
export function onsetDensity(envelope: OnsetEnvelope): number {
  const { strength, rate } = envelope;
  if (strength.length < 3) return 0;

  let mean = 0;
  for (let i = 0; i < strength.length; i++) mean += strength[i];
  mean /= strength.length;
  if (mean === 0) return 0;

  let variance = 0;
  for (let i = 0; i < strength.length; i++) variance += (strength[i] - mean) ** 2;
  const threshold = mean + Math.sqrt(variance / strength.length);

  let peaks = 0;
  for (let i = 1; i < strength.length - 1; i++) {
    const value = strength[i];
    if (value > threshold && value >= strength[i - 1] && value > strength[i + 1]) peaks++;
  }
  return (peaks * rate) / strength.length;
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}
