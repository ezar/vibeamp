/**
 * The domain types shared by the library, the analysis pipeline and the DJ engine.
 *
 * Kept in their own package so that nothing which needs them has to depend on the
 * browser: the DJ engine and the analysis pipeline are both tested in Node.
 */

/** Pitch class name, sharps only. */
export type PitchClassName =
  'C' | 'C#' | 'D' | 'D#' | 'E' | 'F' | 'F#' | 'G' | 'G#' | 'A' | 'A#' | 'B';

export type KeyScale = 'major' | 'minor';

/**
 * Version of the analysis pipeline.
 *
 * Bumped whenever a descriptor changes meaning. On start-up the library marks
 * every track analysed by an older version as pending, which is what lets the
 * pipeline improve without a rescan and without losing the rest of the record.
 */
export const ANALYSIS_VERSION = 1;

/** Sample rate the analysis runs at, in hertz. */
export const TARGET_SAMPLE_RATE = 16000;

export type TrackStatus =
  /** Discovered, not analysed. */
  | 'pending'
  | 'decoding'
  | 'analyzing'
  | 'done'
  /** Failed for a reason worth retrying. */
  | 'failed'
  /** The browser cannot decode it. Never retried. */
  | 'unsupported';

export interface TrackMeta {
  title: string | null;
  artist: string | null;
  albumArtist: string | null;
  album: string | null;
  year: number | null;
  trackNo: number | null;
  genre: string[] | null;
  /** Cover art is cached separately, in the Cache API, keyed by track id. */
  hasCoverArt: boolean;
}

export interface KeyEstimate {
  root: PitchClassName;
  scale: KeyScale;
  /** Confidence of the estimate, 0..1. */
  strength: number;
  /** How far the winner led the best key of the other mode, 0..1. */
  margin: number;
  /** Camelot code, such as `8B`. */
  camelot: string;
}

/** One of the short excerpts a track is analysed over. */
export interface WindowFeatures {
  /** Offset of the window in the track, in seconds. */
  startSec: number;
  /** RMS level, in the sample unit. */
  rms: number;
  /** Spectral centroid, in hertz. */
  centroidHz: number;
  /** Mean spectral flux, in the magnitude unit. */
  flux: number;
  /** Zero crossing rate, as a fraction of samples. */
  zcr: number;
  /** Share of the energy below 200 Hz, 0..1. */
  lowBandRatio: number;
}

/**
 * What the worker returns: descriptors in their own units, not yet normalised.
 *
 * Normalising needs the distribution of the whole library, which the worker has no
 * business knowing about, so it is the library layer's job.
 */
export interface RawFeatures {
  /** Beats per minute, or 0 when no pulse was found. */
  bpm: number;
  bpmConfidence: number;
  keyRoot: PitchClassName;
  keyScale: KeyScale;
  keyStrength: number;
  keyMargin: number;
  /** RMS level of the analysed windows, in dBFS. Negative. */
  loudnessDb: number;
  /** Mean RMS over the windows, in the sample unit. */
  rmsMean: number;
  /** Peak over RMS, as a ratio. */
  crestFactor: number;
  /** Mean spectral centroid over the windows, in hertz. */
  centroidHzMean: number;
  fluxMean: number;
  zcrMean: number;
  /** Danceability proxy, 0..1. See `@vibeamp/dsp`. */
  danceabilityRaw: number;
  windows: WindowFeatures[];
}

/**
 * The descriptors the player and the DJ engine read.
 *
 * Every 0..1 value is a percentile within this library, not an absolute. A jazz
 * collection and a techno collection do not share a scale of energy, and a fixed
 * one would put every track in either at the same end of it.
 */
export interface TrackAnalysis {
  /** Beats per minute, 40..220, or 0 when unknown. */
  bpm: number;
  bpmConfidence: number;
  key: KeyEstimate;
  /** Approximate level in dBFS. Negative. */
  loudnessDb: number;
  /** Loudness as a percentile of the library, 0..1. */
  energy: number;
  /** Spectral centroid as a percentile of the library, 0..1. */
  brightness: number;
  /**
   * How compressed the master is, 0..1, as an inverse percentile of the crest
   * factor. 1 is brickwalled, 0 is untouched.
   *
   * Named for what it measures. The obvious name, "dynamics", reads as dynamic
   * range and would mean the opposite of the number stored here.
   */
  compression: number;
  /** Danceability proxy as a percentile of the library, 0..1. */
  danceability: number;
  /**
   * True while the percentiles were computed against defaults rather than against
   * the library, which is the case until enough tracks have been analysed. The UI
   * says so instead of pretending the numbers are settled.
   */
  provisional: boolean;
  windows: WindowFeatures[];
}

export interface Track {
  /** Content hash: `sha-256(first MiB + ':' + size)`, hex. */
  id: string;
  rootId: string;
  /** Path relative to the root folder. */
  relPath: string;
  fileName: string;
  size: number;
  lastModified: number;
  /** Known once decoded. */
  durationSec: number | null;
  meta: TrackMeta;
  analysis: TrackAnalysis | null;
  /** The pipeline version that produced {@link analysis}. */
  analysisVersion: number;
  analyzedAt: number | null;
  status: TrackStatus;
  errorMessage?: string;
  /** Attempts so far, for the retry backoff. */
  attempts: number;
}

/** A folder the user has granted access to. */
export interface Root {
  id: string;
  name: string;
  addedAt: number;
  lastScanAt: number | null;
}

/** Where the vibe sliders put the target for the next stretch of the queue. */
export interface VibeTarget {
  energy: number;
  brightness: number;
  danceability: number;
  /** 0 favours forgotten tracks, 1 favours the ones played most. */
  familiarity: number;
  /** How much BPM and key matter against variety. Modulates the score weights. */
  coherence: number;
}

/** Shape of the energy curve over a session. */
export type EnergyShape = 'flat' | 'rise' | 'arc' | 'winddown';
