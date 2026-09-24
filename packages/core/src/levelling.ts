/**
 * Playing a collection at one volume.
 *
 * The most boring problem in a music library and the one that interrupts listening
 * most often: a CD mastered in 1985 and a reissue from 2015 are ten decibels apart,
 * so every few tracks somebody reaches for the volume. Tag-based players solve it
 * with ReplayGain, which works beautifully and only for files somebody already
 * tagged — which, in a real collection, is a fraction of them.
 *
 * This library measured the level of every track itself, so the tags are not
 * needed. Nothing new is analysed for this: `loudnessDb` and the crest factor are
 * already stored, and the whole feature is arithmetic over them.
 *
 * Two decisions worth stating:
 *
 * **The reference is the library's own median**, not a fixed level. It is the same
 * argument the percentiles are built on — a jazz collection and a techno collection
 * do not share a scale — and it has a practical edge as well: levelling to the
 * middle of what somebody owns moves half the library up and half of it down, so
 * the collection keeps the volume it had and the master fader stays where it was.
 * An error in the reference is common-mode, shifting every track equally, which is
 * why a median read off a hundred-bucket histogram is precise enough. What has to
 * be precise is each track's own correction, and that comes from its own measured
 * level.
 *
 * **A boost is capped by the headroom actually measured.** Turning a quiet track up
 * is the half of this that can do damage, so it is limited by that track's own peak
 * — and the peak is a lower bound, measured over the analysed windows rather than
 * the whole file, so the cap carries a margin on top.
 */

import { valueAtPercentile } from './normalise.js';
import type { LibraryStatistics } from './normalise.js';
import type { Track } from './types.js';

/**
 * The most a track is moved, in decibels, in either direction.
 *
 * Twelve. Past this the recording is not badly mastered, it is a different kind of
 * thing — a field recording, a locked groove, a spoken interlude — and dragging it
 * to the middle of a record collection would be levelling in the pejorative sense.
 */
export const MAX_TRIM_DB = 12;

/**
 * Decibels left below full scale when a track is turned up.
 *
 * Two, because the peak this is measured against is a lower bound: the crest factor
 * comes from the analysed windows, and the loudest moment of a track may not be in
 * one of them.
 */
export const PEAK_MARGIN_DB = 2;

/**
 * Analysed tracks needed before a reference means anything.
 *
 * Eight. Fewer than that and the median is one particular record, and levelling a
 * whole collection to it is worse than levelling it to nothing.
 */
export const MIN_TRACKS_FOR_LEVELLING = 8;

/**
 * The level the library is levelled to, in dBFS.
 *
 * @returns Null while the library is too small to have a middle, in which case
 *   nothing is trimmed at all. A library that is still being analysed levels
 *   against what has been heard so far, which is the same bargain the percentiles
 *   make.
 */
export function referenceLoudnessDb(statistics: LibraryStatistics): number | null {
  if (statistics.loudness.total < MIN_TRACKS_FOR_LEVELLING) return null;
  const median = valueAtPercentile(statistics.loudness, 0.5);
  if (median === null || median <= 0) return null;
  return toDb(median);
}

/**
 * How much to move a track, in decibels.
 *
 * @returns 0 for a track with no analysis, and for any track the arithmetic cannot
 *   be done for. Zero is the right failure here: it plays exactly as it always did.
 */
export function trimDb(track: Track, referenceDb: number | null): number {
  const analysis = track.analysis;
  if (analysis === null || referenceDb === null) return 0;
  if (!Number.isFinite(analysis.loudnessDb) || !Number.isFinite(referenceDb)) return 0;

  const wanted = clamp(referenceDb - analysis.loudnessDb, -MAX_TRIM_DB, MAX_TRIM_DB);
  if (wanted <= 0) return wanted;

  // Turning a track up is the half that can clip. The crest factor says how far the
  // peaks sit above the RMS this level was measured at, so the two together are a
  // peak, and what is left below full scale is the most it can be raised.
  const crest = analysis.inputs.compression;
  if (!Number.isFinite(crest) || crest <= 0) return 0;
  const peakDb = analysis.loudnessDb + toDb(crest);
  const headroom = -peakDb - PEAK_MARGIN_DB;

  return Math.max(0, Math.min(wanted, headroom));
}

/** Amplitude ratio to decibels. */
function toDb(value: number): number {
  return 20 * Math.log10(value);
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}
