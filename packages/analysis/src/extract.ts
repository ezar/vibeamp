/**
 * The extraction pipeline: samples in, {@link RawFeatures} out.
 *
 * Pure and synchronous. The worker is a thin wrapper around this function, which
 * means the whole pipeline is tested in Node without a browser, and a failure can
 * be reproduced from a generated signal rather than from a file.
 */

import {
  Spectrogram,
  CHROMA_FRAME_SIZE,
  chromaSequence,
  chromaVector,
  crestFactor,
  danceabilityProxy,
  estimateKey,
  estimateTempo,
  lowBandEnergyRatio,
  onsetEnvelope,
  rms,
  spectralCentroid,
  spectralFlux,
  toDbfs,
  zeroCrossingRate,
} from '@vibeamp/dsp';
import { FINGERPRINT_FRAMES, FINGERPRINT_SEGMENTS, encodeFingerprint } from '@vibeamp/core';
import type { RawFeatures, WindowFeatures } from '@vibeamp/core';
import { MIN_ANALYSABLE_SEC, planWindows } from './windows.js';
import type { SampleWindow } from './windows.js';
import type { Stage, WorkerErrorCode } from './protocol.js';

/** Frame length for the spectral descriptors, in samples. */
const SPECTRAL_FRAME_SIZE = 2048;
/** Hop between spectral frames, in samples. Half a frame. */
const SPECTRAL_HOP_SIZE = 1024;

/** An error the pipeline raises, carrying the code the protocol reports. */
export class ExtractionError extends Error {
  constructor(
    readonly code: WorkerErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ExtractionError';
  }
}

export interface ExtractOptions {
  onProgress?: (stage: Stage, pct: number) => void;
  /**
   * Checked between stages. Cancellation is cooperative because the descriptors are
   * synchronous loops: the pipeline stops at the next boundary rather than part way
   * through an autocorrelation.
   */
  shouldCancel?: () => boolean;
}

/**
 * Extract every descriptor from a mono signal.
 *
 * @param samples Mono samples.
 * @param sampleRate Sample rate, in hertz.
 * @throws ExtractionError with `bad_input`, `too_short` or `cancelled`.
 */
export function extractFeatures(
  samples: Float32Array,
  sampleRate: number,
  options: ExtractOptions = {},
): RawFeatures {
  const { onProgress, shouldCancel } = options;
  const report = (stage: Stage, pct: number): void => {
    if (shouldCancel?.() === true) {
      throw new ExtractionError('cancelled', 'cancelled by the pool');
    }
    onProgress?.(stage, pct);
  };

  if (samples.length === 0 || !Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new ExtractionError('bad_input', 'empty signal or invalid sample rate');
  }

  report('windowing', 0);
  const plan = planWindows(samples.length, sampleRate);
  if (plan === null) {
    throw new ExtractionError(
      'too_short',
      `shorter than ${MIN_ANALYSABLE_SEC}s; probably a sound effect or a truncated file`,
    );
  }

  report('spectral', 0.1);
  const windows = plan.descriptor.map((window) => measureWindow(samples, sampleRate, window));

  report('rhythm', 0.4);
  const tempoSlice = sliceOf(samples, plan.tempo);
  const envelope = onsetEnvelope(tempoSlice, sampleRate);
  const tempo = estimateTempo(envelope);

  report('tonal', 0.7);
  const chroma = averageChroma(samples, sampleRate, plan.descriptor);
  const key = estimateKey(chroma);

  report('finalizing', 0.9);
  const rmsMean = mean(windows.map((window) => window.rms));
  const lowBandMean = mean(windows.map((window) => window.lowBandRatio));

  // The crest factor is taken over the descriptor windows joined together rather
  // than over the whole file, so that a long silent tail cannot inflate it.
  const joined = concatWindows(samples, plan.descriptor);

  const features: RawFeatures = {
    bpm: tempo.bpm,
    bpmConfidence: tempo.confidence,
    keyRoot: key.root,
    keyScale: key.scale,
    keyStrength: key.strength,
    keyMargin: key.margin,
    loudnessDb: toDbfs(rmsMean),
    rmsMean,
    crestFactor: crestFactor(joined),
    centroidHzMean: mean(windows.map((window) => window.centroidHz)),
    fluxMean: mean(windows.map((window) => window.flux)),
    zcrMean: mean(windows.map((window) => window.zcr)),
    danceabilityRaw: danceabilityProxy({
      envelope,
      pulseClarity: tempo.confidence,
      lowBandRatio: lowBandMean,
    }),
    fingerprint: buildFingerprint(samples, sampleRate, plan.descriptor),
    windows,
  };

  report('finalizing', 1);
  return features;
}

/** Every spectral and level descriptor over one window. */
function measureWindow(
  samples: Float32Array,
  sampleRate: number,
  window: SampleWindow,
): WindowFeatures {
  const slice = sliceOf(samples, window);
  const spectrogram = new Spectrogram({
    frameSize: SPECTRAL_FRAME_SIZE,
    hopSize: SPECTRAL_HOP_SIZE,
  });
  const frames = spectrogram.frameCount(slice.length);

  const magnitudes = new Float64Array(spectrogram.binCount);
  const previous = new Float64Array(spectrogram.binCount);
  let centroidSum = 0;
  let fluxSum = 0;
  let lowBandSum = 0;

  for (let frame = 0; frame < frames; frame++) {
    spectrogram.magnitudesAt(slice, frame * SPECTRAL_HOP_SIZE, magnitudes);
    centroidSum += spectralCentroid(magnitudes, sampleRate, SPECTRAL_FRAME_SIZE);
    lowBandSum += lowBandEnergyRatio(magnitudes, sampleRate, SPECTRAL_FRAME_SIZE);
    if (frame > 0) fluxSum += spectralFlux(magnitudes, previous);
    previous.set(magnitudes);
  }

  const divisor = Math.max(1, frames);
  return {
    startSec: window.startSec,
    rms: rms(slice),
    centroidHz: centroidSum / divisor,
    flux: fluxSum / Math.max(1, frames - 1),
    zcr: zeroCrossingRate(slice, 0, slice.length),
    lowBandRatio: lowBandSum / divisor,
  };
}

/**
 * The chroma sequence the duplicate finder compares, packed for storage.
 *
 * Built from the same windows the descriptors use, so it costs one more pass over
 * thirty seconds of audio rather than over the whole file. When a plan has fewer
 * windows than a fingerprint has segments — a short track is analysed as one — the
 * single window is divided into that many, which keeps every fingerprint the same
 * shape and keeps two tracks of the same length sampling the same moments.
 *
 * A frame shorter than one chroma FFT window yields zeros, and a fingerprint of
 * zeros is not a weak fingerprint — it is a blank one that would sit at distance
 * zero from every other blank one. So a track too short to fill the shape gets no
 * fingerprint at all. At the analysis rate that floor is about fifteen seconds,
 * which is an interlude or a sound effect rather than a recording anyone keeps two
 * copies of.
 *
 * @returns Null when the windows cannot fill the shape.
 */
function buildFingerprint(
  samples: Float32Array,
  sampleRate: number,
  windows: readonly SampleWindow[],
): string | null {
  if (windows.length === 0) return null;

  const segments: SampleWindow[] = [];
  if (windows.length >= FINGERPRINT_SEGMENTS) {
    segments.push(...windows.slice(0, FINGERPRINT_SEGMENTS));
  } else {
    const whole = windows[0];
    if (whole === undefined) return null;
    for (let i = 0; i < FINGERPRINT_SEGMENTS; i += 1) {
      const offset = whole.offset + Math.floor((i * whole.length) / FINGERPRINT_SEGMENTS);
      const next = whole.offset + Math.floor(((i + 1) * whole.length) / FINGERPRINT_SEGMENTS);
      segments.push({ offset, length: next - offset, startSec: offset / sampleRate });
    }
  }

  // Checked before any work: every segment must afford a full FFT window per frame.
  const shortest = Math.min(...segments.map((segment) => segment.length));
  if (shortest < FINGERPRINT_FRAMES * CHROMA_FRAME_SIZE) return null;

  const frames: number[][] = [];
  for (const segment of segments) {
    for (const frame of chromaSequence(sliceOf(samples, segment), sampleRate, FINGERPRINT_FRAMES)) {
      frames.push([...frame]);
    }
  }
  return encodeFingerprint(frames);
}

/**
 * Mean chroma over the windows.
 *
 * Averaging the windows rather than analysing one of them matters for key: a track
 * with a modulation or a long intro in another key gets both, and the profile
 * correlation then reflects the track instead of one arbitrary ten seconds of it.
 */
function averageChroma(
  samples: Float32Array,
  sampleRate: number,
  windows: readonly SampleWindow[],
): Float64Array {
  const total = new Float64Array(12);
  let counted = 0;

  for (const window of windows) {
    const chroma = chromaVector(sliceOf(samples, window), sampleRate);
    let hasEnergy = false;
    for (let i = 0; i < 12; i++) {
      if ((chroma[i] ?? 0) > 0) hasEnergy = true;
    }
    if (!hasEnergy) continue;
    for (let i = 0; i < 12; i++) total[i] = (total[i] ?? 0) + (chroma[i] ?? 0);
    counted++;
  }

  if (counted === 0) return total;
  for (let i = 0; i < 12; i++) total[i] = (total[i] ?? 0) / counted;
  return total;
}

/** A view on the signal. No copy: the windows are read, never written. */
function sliceOf(samples: Float32Array, window: SampleWindow): Float32Array {
  const start = Math.max(0, Math.min(window.offset, samples.length));
  const end = Math.max(start, Math.min(start + window.length, samples.length));
  return samples.subarray(start, end);
}

/** The windows joined into one buffer. */
function concatWindows(samples: Float32Array, windows: readonly SampleWindow[]): Float32Array {
  const slices = windows.map((window) => sliceOf(samples, window));
  const total = slices.reduce((sum, slice) => sum + slice.length, 0);
  const out = new Float32Array(total);
  let offset = 0;
  for (const slice of slices) {
    out.set(slice, offset);
    offset += slice.length;
  }
  return out;
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const value of values) sum += value;
  return sum / values.length;
}
