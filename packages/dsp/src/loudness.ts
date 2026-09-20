/**
 * Level descriptors.
 *
 * These are plain amplitude measures, not ITU-R BS.1770 loudness: the analysis
 * runs on a 16 kHz mono downmix, which has already thrown away what a K-weighted
 * measurement would need. They are used only to compare tracks within one
 * library, and for that a consistent measure beats an accurate one.
 */

import { peakAmplitude, rms } from './spectral.js';

/** Convert an amplitude in the sample unit to decibels relative to full scale. */
export function toDbfs(amplitude: number): number {
  if (amplitude <= 0) return -Infinity;
  return 20 * Math.log10(amplitude);
}

/**
 * Crest factor: peak divided by RMS, as a ratio.
 *
 * A proxy for how hard a track was compressed. A quiet acoustic recording sits
 * around 8 or more; a loudness-war master approaches 2. The DJ engine reads it as
 * "dynamics" so that a delicate track is not dropped next to a brickwalled one.
 *
 * @returns The ratio, or 1 for silence.
 */
export function crestFactor(signal: Float32Array): number {
  const level = rms(signal);
  if (level === 0) return 1;
  return peakAmplitude(signal) / level;
}

/** RMS level of a whole signal, in dBFS. `-Infinity` for digital silence. */
export function rmsDbfs(signal: Float32Array): number {
  return toDbfs(rms(signal));
}
