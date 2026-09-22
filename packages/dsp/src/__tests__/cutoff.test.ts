/**
 * Finding the edge an encoder leaves.
 *
 * The measure is only worth anything if it lands on the right frequency, so the
 * signals here have a cutoff put in by hand and the test asks for it back. The
 * floor in `cutoff.ts` is a number with a claim attached — that a brick wall falls
 * below it and a real quiet top end does not — and these are where that claim is
 * kept true.
 */

import { describe, expect, it } from 'vitest';
import { CUTOFF_BAND_HZ, spectralCutoff } from '../cutoff.js';

const RATE = 44_100;
const SECONDS = 2;
/** Spacing of the components the test signals are built from, in hertz. */
const COMPONENT_HZ = 100;

/**
 * Noise built up to a wall and no further.
 *
 * Synthesised rather than filtered. A filter steep enough to stand in for an
 * encoder's brick wall is harder to write than the signal it would produce: eight
 * cascaded one-pole sections only reach about −48 dB at Nyquist, which is above
 * the floor this measure uses, so the "filtered" signal still has a top end and
 * the test would be measuring the filter rather than the measure.
 *
 * Summing random-phase components up to the corner and stopping puts the wall
 * exactly where the test says it is.
 */
function noiseUpTo(cornerHz: number, seed = 1): Float32Array {
  const out = new Float32Array(RATE * SECONDS);
  let state = seed;
  const random = (): number => (state = (state * 1664525 + 1013904223) >>> 0) / 4294967296;

  const top = Math.min(cornerHz, RATE / 2 - COMPONENT_HZ);
  for (let hz = COMPONENT_HZ; hz <= top; hz += COMPONENT_HZ) {
    const phase = random() * 2 * Math.PI;
    const step = (2 * Math.PI * hz) / RATE;
    for (let i = 0; i < out.length; i += 1) out[i] = (out[i] ?? 0) + Math.cos(phase + step * i);
  }

  let peak = 0;
  for (const sample of out) peak = Math.max(peak, Math.abs(sample));
  if (peak > 0) for (let i = 0; i < out.length; i += 1) out[i] = ((out[i] ?? 0) / peak) * 0.9;
  return out;
}

/** Everything up to Nyquist: a file nothing took the top off. */
function fullBand(seed = 1): Float32Array {
  return noiseUpTo(RATE / 2, seed);
}

describe('finding the cutoff', () => {
  it.each([[11_000], [16_000], [19_000]])('lands within a band of a wall at %i Hz', (corner) => {
    const found = spectralCutoff(noiseUpTo(corner), RATE);
    expect(found).not.toBeNull();
    // Within two bands, which is the resolution this reports at.
    expect(Math.abs(found! - corner)).toBeLessThanOrEqual(2 * CUTOFF_BAND_HZ);
  });

  it('reaches the top for a signal nothing took the top off', () => {
    // Full-band noise: the answer should be near Nyquist, not some middle value.
    const found = spectralCutoff(fullBand(), RATE);
    expect(found).not.toBeNull();
    expect(found!).toBeGreaterThan(20_000);
  });

  it('separates a 128k wall from a lossless top end by a wide margin', () => {
    // The whole claim. These two must not be confusable.
    const lossy = spectralCutoff(noiseUpTo(16_000), RATE)!;
    const lossless = spectralCutoff(fullBand(), RATE)!;
    expect(lossless - lossy).toBeGreaterThan(4_000);
  });

  it('is not decided by one broadband frame', () => {
    // A hard cut is a step, and a step has energy at every frequency. So does a
    // click, and so does the join where a track was edited. Taking the median
    // across frames means half the file has to agree before a band counts.
    const cut = noiseUpTo(16_000);
    cut.fill(0, 0, RATE);

    const found = spectralCutoff(cut, RATE)!;
    expect(Math.abs(found - 16_000)).toBeLessThanOrEqual(2 * CUTOFF_BAND_HZ);
  });

  it('has no answer for silence or for a signal too short to frame', () => {
    expect(spectralCutoff(new Float32Array(RATE), RATE)).toBeNull();
    expect(spectralCutoff(new Float32Array(100), RATE)).toBeNull();
  });
});
