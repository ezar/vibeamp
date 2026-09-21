/**
 * Chroma (pitch class profile).
 *
 * Energy is folded onto the twelve pitch classes so that a key estimator sees
 * "how much C is in this music" regardless of octave. Bins are spread over the
 * two nearest pitch classes rather than rounded to one, because at this FFT
 * resolution rounding puts a slightly detuned instrument in the wrong bucket
 * entirely.
 */

import { Spectrogram } from './spectrum.js';

/** Lowest frequency that contributes to chroma, in hertz (roughly E2). */
const MIN_CHROMA_HZ = 80;
/** Highest frequency that contributes to chroma, in hertz. */
const MAX_CHROMA_HZ = 5000;
/** Reference pitch for the MIDI conversion, in hertz. */
const A4_HZ = 440;

/** Frame length for the chroma spectrogram, in samples. Long, for pitch resolution. */
export const CHROMA_FRAME_SIZE = 4096;

/**
 * Accumulate a 12-bin chroma vector over a mono signal.
 *
 * @returns Twelve energies, index 0 = C, normalised so the largest is 1. All
 *   zeros when the signal has no energy in the chroma band.
 */
export function chromaVector(signal: Float32Array, sampleRate: number): Float64Array {
  const chroma = new Float64Array(12);
  const hopSize = CHROMA_FRAME_SIZE / 2;
  const spectrogram = new Spectrogram({ frameSize: CHROMA_FRAME_SIZE, hopSize });
  const frames = spectrogram.frameCount(signal.length);
  if (frames === 0) return chroma;

  const magnitudes = new Float64Array(spectrogram.binCount);
  const minBin = Math.max(1, Math.floor((MIN_CHROMA_HZ * CHROMA_FRAME_SIZE) / sampleRate));
  const maxBin = Math.min(
    spectrogram.binCount - 1,
    Math.ceil((MAX_CHROMA_HZ * CHROMA_FRAME_SIZE) / sampleRate),
  );

  for (let frame = 0; frame < frames; frame++) {
    spectrogram.magnitudesAt(signal, frame * hopSize, magnitudes);
    for (let bin = minBin; bin <= maxBin; bin++) {
      const magnitude = magnitudes[bin];
      if (magnitude === 0) continue;

      const frequency = (bin * sampleRate) / CHROMA_FRAME_SIZE;
      // MIDI 69 is A4, and MIDI note numbers are already aligned to C: 60 is C4, so
      // `midi % 12` is the pitch class with index 0 = C. No rotation is needed, and
      // adding one puts a C major triad on D#, G and A#.
      const midi = 69 + 12 * Math.log2(frequency / A4_HZ);
      const pitchClass = ((midi % 12) + 12) % 12;

      const lower = Math.floor(pitchClass);
      const fraction = pitchClass - lower;
      const energy = magnitude * magnitude;
      chroma[lower % 12] += energy * (1 - fraction);
      chroma[(lower + 1) % 12] += energy * fraction;
    }
  }

  let peak = 0;
  for (let i = 0; i < 12; i++) if (chroma[i] > peak) peak = chroma[i];
  if (peak > 0) for (let i = 0; i < 12; i++) chroma[i] /= peak;
  return chroma;
}

/**
 * Chroma over time, as a fixed number of equal frames.
 *
 * {@link chromaVector} averages a whole excerpt into twelve numbers, which is what
 * a key estimator wants and exactly the wrong thing for telling two recordings
 * apart: the average of a chord progression says which key it is in, not which
 * progression it was. Two different songs in A minor average to nearly the same
 * twelve numbers. Their *sequences* do not.
 *
 * The signal is cut into `frames` equal parts rather than fixed-length ones so that
 * the result has the same shape for every track, whatever its duration. Comparing
 * two of them is then a matter of comparing equally sized matrices.
 *
 * @param frames How many frames to produce. Must be at least 1.
 * @returns `frames` vectors of twelve, each normalised so its largest value is 1,
 *   all zeros where a frame has no energy in the chroma band.
 */
export function chromaSequence(
  signal: Float32Array,
  sampleRate: number,
  frames: number,
): Float64Array[] {
  const count = Math.max(1, Math.floor(frames));
  const out: Float64Array[] = [];
  for (let frame = 0; frame < count; frame++) {
    const from = Math.floor((frame * signal.length) / count);
    const to = Math.floor(((frame + 1) * signal.length) / count);
    // A frame shorter than one FFT window yields nothing; chromaVector returns
    // zeros for it, which is the honest answer rather than a borrowed neighbour.
    out.push(chromaVector(signal.subarray(from, to), sampleRate));
  }
  return out;
}
