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

/**
 * Level at which a sample counts as pinned to the ceiling.
 *
 * Not 1.0. A clipped signal that has been through a resampler no longer sits
 * exactly at full scale — the interpolation rounds the flat top off — so the test
 * has to allow for that or it finds nothing at all.
 */
const CEILING = 0.98;

/**
 * Shortest run of pinned samples that counts as a clipped peak.
 *
 * Three. One sample at full scale is a loud transient; three in a row is a flat
 * top, which is a waveform that was cut off rather than merely loud. The
 * distinction matters because a brickwalled master is loud everywhere and is not a
 * defect anyone can fix, whereas a clipped one has had its peaks destroyed.
 */
const RUN = 3;

/**
 * Share of a signal that sits in a flat-topped peak.
 *
 * Measured after the resample to the analysis rate, which blunts the flat tops it
 * is looking for: what this finds is real, and what it misses may still be there.
 * A lower bound, in other words, and reported as one.
 *
 * @returns 0..1, the fraction of samples belonging to a run of at least
 *   {@link RUN} consecutive samples at or above the ceiling.
 */
export function clippedRatio(samples: Float32Array): number {
  if (samples.length === 0) return 0;

  let clipped = 0;
  let run = 0;
  for (let i = 0; i < samples.length; i += 1) {
    if (Math.abs(samples[i] ?? 0) >= CEILING) {
      run += 1;
      continue;
    }
    if (run >= RUN) clipped += run;
    run = 0;
  }
  if (run >= RUN) clipped += run;

  return clipped / samples.length;
}
