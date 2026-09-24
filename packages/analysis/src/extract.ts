/**
 * The extraction pipeline: samples in, {@link RawFeatures} out.
 *
 * Pure and synchronous. The worker is a thin wrapper around this function, which
 * means the whole pipeline is tested in Node without a browser, and a failure can
 * be reproduced from a generated signal rather than from a file.
 */

import {
  MIN_GRID_STRENGTH,
  Spectrogram,
  CHROMA_FRAME_SIZE,
  beatGrid,
  chromaSequence,
  soundEdges,
  chromaVector,
  clippedRatio,
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

/**
 * How much of the end to measure for a truncated file, in seconds.
 *
 * A quarter second. Long enough that one sample of noise cannot decide it, short
 * enough that an ordinary fade-out has already fallen well below the track's mean
 * by the time this window starts.
 */
const TAIL_SEC = 0.25;

/**
 * How much of each end to read the beat grid from, in seconds.
 *
 * Twenty. Long enough to hold thirty beats at a slow tempo, which is a grid rather
 * than a coincidence, and short enough that a tempo drifting over the length of a
 * song cannot pull the grid away from the moment a fade actually touches.
 */
const EDGE_SEC = 20;

/**
 * Tempo confidence below which no beat grid is measured.
 *
 * The phase of a period nobody believes in is not a fact about the music. Measured:
 * twenty seconds of a held tone comes back with a tempo of 109 BPM at a confidence
 * of 0.08 — the estimator returns a number because it always does — and a grid
 * fitted to it scores 0.41, comfortably over the threshold for a usable one. The
 * grid is not wrong about the envelope; the envelope has a small periodic ripple
 * from the framing, and the grid finds it. What is wrong is asking the question at
 * all, so it is not asked. The same 0.3 the X-ray uses before it will count a
 * tempo.
 */
const MIN_TEMPO_CONFIDENCE = 0.3;

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
   * Side over mid, as RMS, measured by the decoder before it downmixed.
   *
   * Passed in rather than computed here because by the time the samples reach this
   * function there is only one channel left. Null for a mono file, and when the
   * caller did not measure it.
   */
  sideRatio?: number | null;
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

  const edges = beatEdges(samples, sampleRate, tempo);
  const sound = soundEdges(samples, sampleRate);

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
    // Measured over the whole signal rather than the descriptor windows: both of
    // these are about the file, not about the music, and a defect at the very end
    // is exactly what the windows are placed to avoid looking at.
    tailRatio: tailLevel(samples, sampleRate, rmsMean),
    clippedRatio: clippedRatio(samples),
    sideRatio: options.sideRatio ?? null,
    introBeatSec: edges.introBeatSec,
    outroBeatSec: edges.outroBeatSec,
    // Over the whole signal, like the tail and the clipping: this is about the
    // file, and the descriptor windows are placed to avoid looking at its ends.
    soundStartSec: sound?.startSec ?? null,
    soundEndSec: sound?.endSec ?? null,
    windows,
  };

  report('finalizing', 1);
  return features;
}

/**
 * Where the beats fall at each end of the track.
 *
 * Measured at the two ends and nowhere else, because those are the only moments a
 * fade touches. Extrapolating one grid across a whole track would be cheaper and
 * wrong: a quarter of a BPM of error — well inside the estimator's own step — is
 * half a beat after three minutes.
 *
 * Both are returned null for a track with no usable pulse. A grid nobody should
 * act on is worse than no grid, because the code downstream would act on it.
 */
function beatEdges(
  samples: Float32Array,
  sampleRate: number,
  tempo: { bpm: number; confidence: number },
): { introBeatSec: number | null; outroBeatSec: number | null } {
  const bpm = tempo.bpm;
  if (bpm <= 0 || tempo.confidence < MIN_TEMPO_CONFIDENCE) {
    return { introBeatSec: null, outroBeatSec: null };
  }

  const length = Math.min(samples.length, Math.round(EDGE_SEC * sampleRate));
  const tailAt = Math.max(0, samples.length - length);

  const usable = (grid: { phaseSec: number; strength: number } | null): number | null =>
    grid === null || grid.strength < MIN_GRID_STRENGTH ? null : grid.phaseSec;

  const head = usable(beatGrid(onsetEnvelope(samples.subarray(0, length), sampleRate), bpm));
  const tail = usable(beatGrid(onsetEnvelope(samples.subarray(tailAt), sampleRate), bpm));

  return {
    introBeatSec: head,
    // Back into the track's own timeline: the grid was measured from the start of
    // the excerpt, and everything downstream reads times from the start of the file.
    outroBeatSec: tail === null ? null : tailAt / sampleRate + tail,
  };
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
 * Level of the track's last moment, over its own mean.
 *
 * Music stops by decaying: a fade, a released note, a room going quiet. The final
 * quarter second of an ordinary track is a small fraction of its average level. A
 * file that was cut short ends at full level, and this is the number that says so.
 *
 * It is deliberately a ratio and not a verdict. Plenty of music genuinely stops
 * dead on a beat, so this measures and `health.ts` decides what to say about it.
 *
 * @returns The ratio, or 0 when there is nothing to compare against.
 */
function tailLevel(samples: Float32Array, sampleRate: number, meanRms: number): number {
  if (meanRms <= 0 || samples.length === 0) return 0;
  const length = Math.min(samples.length, Math.max(1, Math.round(TAIL_SEC * sampleRate)));
  return rms(samples.subarray(samples.length - length)) / meanRms;
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
