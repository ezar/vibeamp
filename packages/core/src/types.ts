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
export const ANALYSIS_VERSION = 5;

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
  /** Chroma fingerprint, or null when the track was too short to build one. */
  fingerprint: string | null;
  /** RMS of the last moment over the track's own mean. See `health.ts`. */
  tailRatio: number;
  /** Share of the signal sitting in a flat-topped peak, 0..1. A lower bound. */
  clippedRatio: number;
  /** Side over mid, as RMS. 0 is two identical channels; null for a mono file. */
  sideRatio: number | null;
  /** Where a beat falls near the start of the track, in seconds. See `beats.ts`. */
  introBeatSec: number | null;
  /** The same near the end, in seconds from the start of the track. */
  outroBeatSec: number | null;
  /** When the music starts, in seconds. Null for a file of silence. See `edges.ts`. */
  soundStartSec: number | null;
  /** When it stops, in seconds from the start of the file. */
  soundEndSec: number | null;
  windows: WindowFeatures[];
}

/**
 * The raw values the library-relative percentiles were computed from.
 *
 * Stored alongside the percentiles so that re-normalising is exact. Deriving them
 * back out of the percentiles instead is lossy, and the loss compounds every time
 * the library distribution shifts and everything is re-ranked.
 */
export interface NormalisationInputs {
  /** Mean RMS over the analysed windows, in the sample unit. */
  loudness: number;
  /** Mean spectral centroid, in hertz. */
  brightness: number;
  /** Crest factor, as a ratio. */
  compression: number;
  /** Danceability proxy, 0..1. */
  danceability: number;
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
  /** What the percentiles were computed from, so they can be recomputed exactly. */
  inputs: NormalisationInputs;
  /**
   * Chroma fingerprint: how the harmony moves, sampled across the track.
   *
   * The rest of this record says what the track is like. This says which track it
   * is, and it is the only field that does — everything else is an average, and
   * two different songs in the same key at the same tempo average to the same
   * numbers. Null for a track too short to sample. See `fingerprint.ts`.
   */
  fingerprint: string | null;
  /**
   * Level of the track's last moment, over its own mean.
   *
   * Music stops by decaying, so the final quarter second is normally a fraction of
   * the average. A file that ends at full level was cut. See `health.ts`.
   */
  tailRatio: number;
  /** Share of the signal sitting in a flat-topped peak, 0..1. A lower bound. */
  clippedRatio: number;
  /**
   * Side over mid, as RMS, measured before the downmix.
   *
   * 0 means the two channels carry the same signal: a mono recording in a stereo
   * container. Null for a file that is honestly mono, where there is nothing to
   * ask. It is the one thing the mono pipeline would otherwise throw away.
   */
  sideRatio: number | null;
  /**
   * Where a beat falls near the start of the track, in seconds from its start.
   *
   * The tempo says how often the beats come; this says when. Every other beat near
   * the start is this plus a whole number of `60 / bpm`, so one number describes
   * the grid — which is what lets the next track be brought in *on* a beat rather
   * than wherever the fade happened to fall. Null when the opening has no pulse
   * clear enough to act on.
   */
  introBeatSec: number | null;
  /**
   * The same near the end, in seconds from the start of the track.
   *
   * Measured at the end rather than extrapolated from the start. A quarter of a BPM
   * of error over three minutes is half a beat by the last chorus, and the last
   * chorus is the only part a fade ever touches.
   */
  outroBeatSec: number | null;
  /**
   * When the music starts, in seconds from the start of the file.
   *
   * A file's length and a recording's length are different things, and every
   * collection is full of the difference: a rip that kept the lead-in, a download
   * padded by its encoder, a track with the run-out left on. Dead air only — the
   * floor sits forty decibels below the track's own level, so a quiet intro is
   * never mistaken for silence, and a fade-out is not trimmed. Null for a file with
   * nothing in it.
   */
  soundStartSec: number | null;
  /** When it stops, in seconds from the start of the file. See {@link soundStartSec}. */
  soundEndSec: number | null;
  windows: WindowFeatures[];
}

/**
 * A name this library worked out for a file whose tags carry none.
 *
 * Kept beside the tags rather than written into them. Two reasons, and both are
 * about being able to change your mind: a tag is what the file says about itself
 * and a guess must never be mistaken for one, and a folder rescan re-reads the
 * tags, which would wipe anything written into that field. Nothing here is ever
 * written back to the file on disk.
 */
export interface GivenName {
  artist: string | null;
  title: string | null;
  album: string | null;
  trackNo: number | null;
  /** How it was arrived at. See `orphans.ts`. */
  source: 'sound' | 'path';
  /** When it was accepted, so a later, better guess can be told from an older one. */
  at: number;
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
  /**
   * The name this library gave the file, if somebody accepted one.
   *
   * Optional because rows written before this existed do not have the field, and a
   * library is not rebuilt to add one.
   */
  given?: GivenName | null;
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
