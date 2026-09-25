/**
 * The tracks a record does not stop between.
 *
 * Albums are full of them: the applause that carries over, the note that is still
 * ringing when the next song starts, the whole second side of a record that is one
 * piece of music cut into six files because a CD needed track marks. Play those
 * with a four second cross-fade and you have destroyed the join; play them with the
 * ordinary gap between files and you have destroyed it differently.
 *
 * Neither the tags nor the file names say which pairs those are. What says it is
 * the audio at the two ends, and this library measured that when it analysed the
 * files: a track still at full level in its last moment, and one already at full
 * level in its first.
 *
 * Both halves are needed, and so is a third thing: the two files have to be
 * neighbours on the same record. Plenty of music stops dead on a beat and plenty
 * opens in full flow; two unrelated tracks that happen to do both are not a join,
 * they are a coincidence. Requiring all three is what keeps this from gluing a
 * listener's collection together at random.
 *
 * **What this does not claim** is to know what the record intended. A track that
 * genuinely bleeds into the next and one that merely stops hard into a neighbour
 * that starts hard look the same from here, and are not distinguishable from the
 * audio — the second has no silence to find either. That is deliberate rather than
 * a limitation worked around: butting the two together is the right answer in both
 * cases, and a four second cross-fade is the wrong one in both.
 */

import { normaliseName } from './naming.js';
import type { Track } from './types.js';

/**
 * Level at the end of a track, over its own mean, above which it did not decay.
 *
 * The same threshold the condition report uses for an abrupt end, and the same
 * measurement: a three second fade-out lands at 0.047 and a track that runs to its
 * last sample at 0.982. What the condition report has to call a possible truncation,
 * because it is looking at one file, is — for a pair of album neighbours — the
 * ordinary way one track runs into the next.
 */
export const ENDS_RUNNING = 0.5;

/**
 * Level at the start of a track, over its own mean, above which it began at level.
 *
 * Measured through the real pipeline: a track beginning after four tenths of a
 * second of silence scores 0.000, one with a one second fade-in 0.142, one with a
 * half second fade-in 0.283, and one cut out of continuous music 1.017. Half sits
 * between the fade-ins and the running start with room on both sides, and a
 * fade-in is the case that must not be cut into — a fade is how a record begins.
 * See `packages/analysis/src/__tests__/segue.test.ts`.
 */
export const STARTS_RUNNING = 0.5;

/** What the test needs from one side of a join. */
export interface SegueSide {
  album: string | null;
  trackNo: number | null;
  /** The folder the file sits in. Album neighbours are always in one folder. */
  folder: string;
  fileName: string;
  /** Level of the first moment over the track's own mean. */
  headRatio: number;
  /** And of the last. */
  tailRatio: number;
}

/** Read what the test needs off a track, or null when it has not been analysed. */
export function segueSideOf(track: Track): SegueSide | null {
  const analysis = track.analysis;
  if (analysis === null) return null;
  const cut = track.relPath.lastIndexOf('/');
  return {
    album: track.meta.album,
    trackNo: track.meta.trackNo,
    folder: cut === -1 ? '' : track.relPath.slice(0, cut),
    fileName: track.fileName,
    headRatio: analysis.headRatio,
    tailRatio: analysis.tailRatio,
  };
}

/**
 * Does the first track run straight into the second?
 *
 * @returns False for anything it cannot be sure of, which includes either side
 *   being unanalysed. The cost of the two mistakes is not symmetric: missing a join
 *   plays a record the way every other player already does, and inventing one glues
 *   two unrelated tracks together.
 */
export function runsInto(from: SegueSide | null, to: SegueSide | null): boolean {
  if (from === null || to === null) return false;
  if (!areNeighbours(from, to)) return false;
  return from.tailRatio > ENDS_RUNNING && to.headRatio > STARTS_RUNNING;
}

/** A pair of tracks that run together, in the order they run. */
export interface SeguePair {
  from: Track;
  to: Track;
}

/**
 * Every pair in a library that runs together.
 *
 * Folder by folder, because that is where album neighbours live, and in the order
 * the record puts them — a segue is directional, and the second half running into
 * the first is not a thing that happens.
 */
export function findSegues(tracks: readonly Track[]): SeguePair[] {
  const byFolder = new Map<string, Track[]>();
  for (const track of tracks) {
    if (track.analysis === null) continue;
    const side = segueSideOf(track);
    if (side === null) continue;
    const group = byFolder.get(side.folder) ?? [];
    group.push(track);
    byFolder.set(side.folder, group);
  }

  const pairs: SeguePair[] = [];
  for (const group of byFolder.values()) {
    const ordered = [...group].sort(byPosition);
    for (let i = 0; i + 1 < ordered.length; i += 1) {
      const from = ordered[i];
      const to = ordered[i + 1];
      if (from === undefined || to === undefined) continue;
      if (runsInto(segueSideOf(from), segueSideOf(to))) pairs.push({ from, to });
    }
  }
  return pairs;
}

/** Track number where there is one, then file name, which is how a rip is ordered. */
function byPosition(a: Track, b: Track): number {
  const one = a.meta.trackNo;
  const other = b.meta.trackNo;
  if (one !== null && other !== null && one !== other) return one - other;
  return a.fileName.localeCompare(b.fileName, undefined, { numeric: true });
}

/**
 * Are these two files neighbours on one record?
 *
 * The same folder always, because album tracks are never scattered. Then either
 * consecutive track numbers on the same album, or consecutive numbers in the file
 * names — the second is what covers the rips this library also has to give names
 * to, which have no tags at all.
 */
function areNeighbours(from: SegueSide, to: SegueSide): boolean {
  if (from.folder !== to.folder) return false;
  if (from.fileName === to.fileName) return false;

  if (
    from.trackNo !== null &&
    to.trackNo !== null &&
    from.trackNo + 1 === to.trackNo &&
    sameAlbum(from, to)
  ) {
    return true;
  }

  const first = leadingNumber(from.fileName);
  const second = leadingNumber(to.fileName);
  return first !== null && second !== null && first + 1 === second;
}

/** Two tracks claiming the same record, allowing for how the two were typed. */
function sameAlbum(from: SegueSide, to: SegueSide): boolean {
  if (from.album === null || to.album === null) return false;
  const one = normaliseName(from.album);
  return one !== '' && one === normaliseName(to.album);
}

/** The track number a file name starts with, if it starts with one. */
function leadingNumber(fileName: string): number | null {
  // A disc prefix is allowed in front of it, as `1-05`, and is not the number.
  const match = /^\s*(?:\d{1,2}[-_.\s]+)?(\d{1,3})(?!\d)/.exec(fileName);
  if (match === null) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}
