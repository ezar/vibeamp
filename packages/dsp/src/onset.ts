/**
 * Onset strength envelope.
 *
 * Tempo and danceability both read the same envelope, so it is computed once and
 * passed around: it is the expensive part (one FFT per hop), and running it twice
 * doubles the cost of the slowest descriptor in the pipeline.
 */

import { Spectrogram } from './spectrum.js';
import { spectralFlux } from './spectral.js';

/** Frame length used for the onset envelope, in samples. */
export const ONSET_FRAME_SIZE = 1024;

/**
 * Envelope sample rate, in hertz. The hop is derived from this and the audio
 * sample rate, so the envelope has the same time resolution whatever the input.
 */
export const ONSET_ENVELOPE_RATE = 100;

export interface OnsetEnvelope {
  /** Onset strength per envelope frame, half-wave rectified and mean-removed. */
  strength: Float64Array;
  /** Envelope frames per second. */
  rate: number;
  /**
   * Largest strength divided by the mean strength, 1 upwards.
   *
   * How spiky the envelope is, independent of its scale. Tens for percussive
   * music, low single digits for a sustained tone, whose envelope is a smooth
   * ripple rather than a series of events. A tempo estimator needs this: a ripple
   * is periodic, so periodicity on its own is not evidence of a beat.
   */
  peakiness: number;
}

/**
 * Compute the onset strength envelope of a mono signal.
 *
 * The raw curve is spectral flux; it is then smoothed against its own local mean
 * so that a loud passage does not read as a continuous onset. What is left is
 * "something started here", which is what a tempo estimator needs.
 */
export function onsetEnvelope(signal: Float32Array, sampleRate: number): OnsetEnvelope {
  const hopSize = Math.max(1, Math.round(sampleRate / ONSET_ENVELOPE_RATE));
  const rate = sampleRate / hopSize;
  const spectrogram = new Spectrogram({ frameSize: ONSET_FRAME_SIZE, hopSize });
  const frames = spectrogram.frameCount(signal.length);
  if (frames < 2) return { strength: new Float64Array(0), rate, peakiness: 1 };

  const current = new Float64Array(spectrogram.binCount);
  const previous = new Float64Array(spectrogram.binCount);
  const raw = new Float64Array(frames - 1);

  spectrogram.magnitudesAt(signal, 0, previous);
  for (let frame = 1; frame < frames; frame++) {
    spectrogram.magnitudesAt(signal, frame * hopSize, current);
    raw[frame - 1] = spectralFlux(current, previous);
    previous.set(current);
  }

  // Smoothing first: at a 100 Hz envelope rate, single-frame jitter is never an
  // onset, and the interaction between the hop size and a steady tone's phase
  // leaves a fast ripple that is not one either.
  const smoothed = movingAverage(raw, 1);
  const strength = removeLocalMean(smoothed, Math.round(rate * 0.4));
  return { strength, rate, peakiness: peakinessOf(strength) };
}

/** Centred moving average over `2 * radius + 1` frames. */
function movingAverage(signal: Float64Array, radius: number): Float64Array {
  const n = signal.length;
  if (radius < 1 || n === 0) return signal;
  const out = new Float64Array(n);
  const prefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + signal[i];
  for (let i = 0; i < n; i++) {
    const from = Math.max(0, i - radius);
    const to = Math.min(n, i + radius + 1);
    out[i] = (prefix[to] - prefix[from]) / (to - from);
  }
  return out;
}

/** Largest value over the mean. 1 for anything flat, including all zeros. */
function peakinessOf(strength: Float64Array): number {
  if (strength.length === 0) return 1;
  let mean = 0;
  let peak = 0;
  for (let i = 0; i < strength.length; i++) {
    mean += strength[i];
    if (strength[i] > peak) peak = strength[i];
  }
  mean /= strength.length;
  return mean <= 0 ? 1 : peak / mean;
}

/**
 * Subtract a centred moving average and half-wave rectify.
 *
 * @param radius Half-width of the averaging window, in frames.
 */
function removeLocalMean(signal: Float64Array, radius: number): Float64Array {
  const n = signal.length;
  const out = new Float64Array(n);
  if (n === 0) return out;

  // Prefix sums keep this linear; with a 0.4 s window at 100 Hz the naive form is
  // 80 additions per frame, which is real time on a long track.
  const prefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + signal[i];

  for (let i = 0; i < n; i++) {
    const from = Math.max(0, i - radius);
    const to = Math.min(n, i + radius + 1);
    const mean = (prefix[to] - prefix[from]) / (to - from);
    const value = signal[i] - mean;
    out[i] = value > 0 ? value : 0;
  }
  return out;
}
