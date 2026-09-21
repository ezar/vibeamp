/**
 * Library-relative normalisation.
 *
 * Every 0..1 descriptor is a percentile within the user's own library. A fixed
 * scale cannot work: mastered techno and close-miked jazz do not overlap on
 * loudness or on brightness, and a constant would put every track in either
 * collection at the same end of the slider, which makes the sliders useless.
 *
 * The distribution is kept as a 100 bucket histogram per descriptor, which is a
 * few hundred bytes, updates in constant time and is accurate to one percentile.
 * Keeping every value instead would mean loading the whole library to normalise
 * one track.
 */

import type { NormalisationInputs, RawFeatures, TrackAnalysis } from './types.js';
import { toCamelot } from './camelot.js';

/** Buckets per histogram. One per percentile. */
export const BUCKET_COUNT = 100;

/**
 * Analysed tracks needed before percentiles mean anything.
 *
 * Below this the descriptors are mapped through the fixed ranges below and marked
 * provisional; on crossing it, every derived value is recomputed in one pass,
 * which is cheap because it never touches the audio again.
 */
export const MIN_TRACKS_FOR_PERCENTILES = 50;

export interface Histogram {
  /** Lower edge of the first bucket. */
  min: number;
  /** Upper edge of the last bucket. */
  max: number;
  counts: number[];
  total: number;
}

/** The descriptors that are normalised against the library. */
export type NormalisedDescriptor = 'loudness' | 'brightness' | 'compression' | 'danceability';

/**
 * Fallback ranges, used while the library is too small for percentiles.
 *
 * Deliberately wide. They are also the histogram bounds, so a value outside one is
 * clamped into the end bucket rather than distorting the scale.
 */
export const DEFAULT_RANGES: Record<NormalisedDescriptor, { min: number; max: number }> = {
  /** RMS in the sample unit: -60 dBFS to full scale. */
  loudness: { min: 0, max: 0.5 },
  /** Spectral centroid in hertz. The analysis runs at 16 kHz, so 8 kHz is Nyquist. */
  brightness: { min: 0, max: 5000 },
  /** Crest factor as a ratio: 1.5 is brickwalled, 15 is an untouched recording. */
  compression: { min: 1.5, max: 15 },
  /** The danceability proxy is already 0..1. */
  danceability: { min: 0, max: 1 },
};

export type LibraryStatistics = Record<NormalisedDescriptor, Histogram>;

/** A histogram over `[min, max]` with no samples yet. */
export function createHistogram(min: number, max: number): Histogram {
  if (!(max > min)) throw new Error(`histogram needs max > min, got ${min}..${max}`);
  return { min, max, counts: new Array<number>(BUCKET_COUNT).fill(0), total: 0 };
}

/** Empty statistics with every histogram on its default range. */
export function createLibraryStatistics(): LibraryStatistics {
  return {
    loudness: createHistogram(DEFAULT_RANGES.loudness.min, DEFAULT_RANGES.loudness.max),
    brightness: createHistogram(DEFAULT_RANGES.brightness.min, DEFAULT_RANGES.brightness.max),
    compression: createHistogram(DEFAULT_RANGES.compression.min, DEFAULT_RANGES.compression.max),
    danceability: createHistogram(DEFAULT_RANGES.danceability.min, DEFAULT_RANGES.danceability.max),
  };
}

/** Which bucket a value falls in, clamped to the histogram's range. */
function bucketOf(histogram: Histogram, value: number): number {
  const { min, max } = histogram;
  const position = ((value - min) / (max - min)) * BUCKET_COUNT;
  if (!Number.isFinite(position) || position < 0) return 0;
  return Math.min(BUCKET_COUNT - 1, Math.floor(position));
}

/**
 * Record one sample.
 *
 * A value that is not a finite number is ignored rather than counted, because
 * bucketing it would quietly weight the first bucket and tilt every percentile
 * that follows.
 */
export function addSample(histogram: Histogram, value: number): void {
  if (!Number.isFinite(value)) return;
  const bucket = bucketOf(histogram, value);
  histogram.counts[bucket] = (histogram.counts[bucket] ?? 0) + 1;
  histogram.total++;
}

/**
 * Where a value sits in the distribution, 0..1.
 *
 * Interpolated within the value's own bucket, so that a library whose values all
 * land in two or three buckets still produces a usable spread instead of three
 * distinct answers. Returns 0.5 for an empty histogram and for a value that is not
 * a finite number, because with no evidence the honest answer is "in the middle".
 */
export function percentileOf(histogram: Histogram, value: number): number {
  if (histogram.total === 0 || !Number.isFinite(value)) return 0.5;

  const bucket = bucketOf(histogram, value);
  let below = 0;
  for (let i = 0; i < bucket; i++) below += histogram.counts[i] ?? 0;
  const inBucket = histogram.counts[bucket] ?? 0;

  const { min, max } = histogram;
  const bucketWidth = (max - min) / BUCKET_COUNT;

  // Measured from this bucket's own start, with the value clamped into the
  // histogram first. Taking the remainder of the raw offset instead wraps at the
  // far edge: a value sitting exactly on `max` lands in the last bucket but scores
  // 0 within it, so the loudest track in a library comes out as its quietest.
  const clamped = value < min ? min : value > max ? max : value;
  const bucketStart = min + bucket * bucketWidth;
  const positionInBucket = bucketWidth === 0 ? 0.5 : (clamped - bucketStart) / bucketWidth;

  const rank = below + inBucket * clamp01(positionInBucket);
  return clamp01(rank / histogram.total);
}

/** Linear position of a value in a fixed range, 0..1. */
function linearIn(range: { min: number; max: number }, value: number): number {
  return clamp01((value - range.min) / (range.max - range.min));
}

/** The raw value each normalised descriptor is derived from. */
export function descriptorInputs(raw: RawFeatures): NormalisationInputs {
  return {
    loudness: raw.rmsMean,
    brightness: raw.centroidHzMean,
    compression: raw.crestFactor,
    danceability: raw.danceabilityRaw,
  };
}

/** Fold a track's descriptors into the library distribution. */
export function recordFeatures(statistics: LibraryStatistics, raw: RawFeatures): void {
  recordInputs(statistics, descriptorInputs(raw));
}

/**
 * Fold already-extracted inputs into a distribution.
 *
 * What rebuilding the distribution from scratch needs: every analysis stores the
 * values its percentiles came from, so the histograms can be recomputed over the
 * whole library without decoding anything. Merging two libraries' histograms would
 * be the alternative, and it is simply wrong — they count different tracks.
 */
export function recordInputs(statistics: LibraryStatistics, inputs: NormalisationInputs): void {
  addSample(statistics.loudness, inputs.loudness);
  addSample(statistics.brightness, inputs.brightness);
  addSample(statistics.compression, inputs.compression);
  addSample(statistics.danceability, inputs.danceability);
}

/**
 * Turn the worker's raw output into the descriptors the player reads.
 *
 * @param statistics The library distribution. Used for percentiles once it holds
 *   at least {@link MIN_TRACKS_FOR_PERCENTILES} tracks; below that the fixed
 *   ranges are used and the result is marked provisional.
 */
export function normaliseFeatures(raw: RawFeatures, statistics: LibraryStatistics): TrackAnalysis {
  const inputs = descriptorInputs(raw);
  const provisional = statistics.loudness.total < MIN_TRACKS_FOR_PERCENTILES;

  const position = (descriptor: NormalisedDescriptor): number =>
    provisional
      ? linearIn(DEFAULT_RANGES[descriptor], inputs[descriptor])
      : percentileOf(statistics[descriptor], inputs[descriptor]);

  return {
    bpm: raw.bpm,
    bpmConfidence: raw.bpmConfidence,
    key: {
      root: raw.keyRoot,
      scale: raw.keyScale,
      strength: raw.keyStrength,
      margin: raw.keyMargin,
      camelot: toCamelot(raw.keyRoot, raw.keyScale),
    },
    loudnessDb: raw.loudnessDb,
    energy: position('loudness'),
    brightness: position('brightness'),
    // Inverted, because the descriptor counts compression and the crest factor
    // measures its absence: a brickwalled master has a low crest factor and must
    // come out near 1.
    compression: 1 - position('compression'),
    danceability: position('danceability'),
    provisional,
    inputs,
    fingerprint: raw.fingerprint,
    windows: raw.windows,
  };
}

/**
 * Recompute an analysis's percentiles against a distribution, exactly.
 *
 * Used when the library crosses the threshold where percentiles start to mean
 * something, and after an import shifts the distribution. Reads the stored inputs,
 * so it never needs the audio and never loses precision.
 */
export function renormalise(analysis: TrackAnalysis, statistics: LibraryStatistics): TrackAnalysis {
  const provisional = statistics.loudness.total < MIN_TRACKS_FOR_PERCENTILES;
  const inputs = analysis.inputs;

  const position = (descriptor: NormalisedDescriptor): number =>
    provisional
      ? linearIn(DEFAULT_RANGES[descriptor], inputs[descriptor])
      : percentileOf(statistics[descriptor], inputs[descriptor]);

  return {
    ...analysis,
    energy: position('loudness'),
    brightness: position('brightness'),
    compression: 1 - position('compression'),
    danceability: position('danceability'),
    provisional,
  };
}

function clamp01(value: number): number {
  // NaN compares false against both bounds, so it has to be caught first or it
  // passes straight through a naive clamp.
  if (Number.isNaN(value)) return 0;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}
