/**
 * The same recording, twice.
 *
 * Every library has them: the 320 and the 128 of the same rip, the album track and
 * the one off the compilation, the remaster beside the original. Tag-based tools
 * miss all three, because the tags are exactly what differs.
 *
 * Nothing new is measured for this. Identical files never reach here — a track is
 * keyed by the hash of its contents, so two copies of the same bytes are already
 * one row. What is left is files that differ, and whether the music inside them is
 * the same is answered by two things and deliberately not by the rest:
 *
 * - **Duration** buckets the candidates. The same recording keeps its length, and
 *   bucketing makes this a sweep over neighbours rather than every pair against
 *   every other.
 * - **The fingerprint** decides. It is the only stored descriptor that is not an
 *   average, and averages cannot do this job: measured through the real pipeline,
 *   they put a remaster at 0.119 from its original and a different piece at the
 *   same tempo, key and length at 0.071 — the wrong way round, with no threshold
 *   in between. See `fingerprint.ts`.
 *
 * What is deliberately *not* used is as much of the design as what is. Tempo and
 * key look like free rule-outs and are not: tempo estimates are octave-ambiguous,
 * so a true pair can read 120 and 240, and a minor key reads as its relative major
 * often enough that one copy of a pair lands on 8A and the other on 8B. Both would
 * discard a real duplicate to save a comparison the fingerprint makes anyway — it
 * scores a tempo-shifted pair at 0.25 and a transposed one at 0.99, far outside
 * the threshold. The spectral windows are left out for the opposite reason: they
 * move under exactly the transformations this must see through, and including them
 * pushed the remaster from 0.001 to 0.060, towards the wrong answer.
 *
 * This reports. It never deletes, and it never picks a winner: an instrumental, a
 * radio edit or a different take at the same tempo and length can land here, and
 * only the person who owns the records can tell.
 */

import { fingerprintDistance } from './fingerprint.js';
import type { Track } from './types.js';

/** What kind of pair this is, as far as the descriptors can tell. */
export type DuplicateVerdict =
  /** Same performance, same mastering: almost certainly one of these can go. */
  | 'same-master'
  /** Same performance, mastered differently — a remaster, or a loudness-war reissue. */
  | 'different-master';

export interface DuplicateGroup {
  /** The tracks that matched, oldest file first so the original tends to lead. */
  tracks: Track[];
  verdict: DuplicateVerdict;
  /** How close the nearest pair in the group was. 0 is indistinguishable. */
  distance: number;
}

export interface DuplicateOptions {
  /**
   * How much two durations may differ and still be the same recording, in seconds.
   *
   * A second and a half: encoders pad, and a fade can be trimmed, but a different
   * recording of the same piece is rarely this close. It is also what the
   * fingerprint's own tolerance for sliding is sized against.
   */
  durationToleranceSec?: number;
  /** How far apart two tracks may be and still count. Raise it to see more. */
  threshold?: number;
}

/**
 * The default threshold, and where it comes from.
 *
 * Measured, not chosen. Through the real pipeline, on pairs built to be hard:
 *
 * | pair                                      | distance |
 * | ----------------------------------------- | -------- |
 * | re-encoded, gain changed, shifted 26ms     |   0.0002 |
 * | remastered: compressed 3.2:1               |   0.0005 |
 * | same music, brighter percussion            |   0.0000 |
 * | same music re-performed                    |   0.0569 |
 * | same key and tempo, major instead of minor |   0.1818 |
 * | same key and tempo, another progression    |   0.8701 |
 * | transposed a minor third                   |   0.9946 |
 * | same music at 128 BPM instead of 120       |   0.2548 |
 *
 * 0.12 sits in the gap: above every pair that is the same recording, below every
 * pair that is not. `packages/analysis/src/__tests__/duplicates.test.ts` holds the
 * measurement, so a change to the pipeline that closes the gap fails there rather
 * than quietly turning this into a machine for crying wolf.
 */
export const DUPLICATE_THRESHOLD = 0.12;

const DEFAULTS = {
  durationToleranceSec: 1.5,
  threshold: DUPLICATE_THRESHOLD,
} as const;

/**
 * Loudness difference, in dB, above which two matching recordings are called
 * different masters rather than the same one.
 */
const REMASTER_DB = 2.5;
/** The same, for the crest factor percentile. */
const REMASTER_COMPRESSION = 0.12;

/**
 * Find the groups of tracks that hold the same recording.
 *
 * @returns Groups of two or more, nearest match first. Empty when nothing matched,
 *   which is the answer for most libraries and is not a failure.
 */
export function findDuplicates(
  tracks: readonly Track[],
  options: DuplicateOptions = {},
): DuplicateGroup[] {
  const durationTolerance = options.durationToleranceSec ?? DEFAULTS.durationToleranceSec;
  const threshold = options.threshold ?? DEFAULTS.threshold;

  const usable = tracks.filter(
    (track) =>
      track.analysis !== null && track.analysis.fingerprint !== null && track.durationSec !== null,
  );

  // Sorting by duration makes the candidates for any track a short run of its
  // neighbours, so the whole thing stays linear in practice.
  const byDuration = [...usable].sort((a, b) => (a.durationSec ?? 0) - (b.durationSec ?? 0));

  const parent = new Map<string, string>();
  const distances = new Map<string, number>();
  const verdicts = new Map<string, DuplicateVerdict>();

  for (let i = 0; i < byDuration.length; i += 1) {
    const a = byDuration[i];
    if (a === undefined) continue;

    for (let j = i + 1; j < byDuration.length; j += 1) {
      const b = byDuration[j];
      if (b === undefined) continue;
      // Sorted, so once the gap is too wide every later track is too.
      if ((b.durationSec ?? 0) - (a.durationSec ?? 0) > durationTolerance) break;

      const distance = pairDistance(a, b);
      if (distance === null || distance > threshold) continue;

      const root = union(parent, a.id, b.id);
      distances.set(root, Math.min(distances.get(root) ?? Infinity, distance));
      // One differently mastered pair makes the whole group worth a second look.
      if (verdicts.get(root) !== 'different-master') {
        verdicts.set(root, verdictFor(a, b));
      }
    }
  }

  const byRoot = new Map<string, Track[]>();
  for (const track of byDuration) {
    if (!parent.has(track.id)) continue;
    const root = find(parent, track.id);
    const group = byRoot.get(root) ?? [];
    group.push(track);
    byRoot.set(root, group);
  }

  return [...byRoot.entries()]
    .map(([root, group]) => ({
      // Oldest file first: the one that has been there longest is usually the one
      // the person meant to keep.
      tracks: [...group].sort((a, b) => a.lastModified - b.lastModified),
      verdict: verdicts.get(root) ?? 'same-master',
      distance: distances.get(root) ?? 0,
    }))
    .sort((a, b) => a.distance - b.distance);
}

/**
 * How far apart two tracks are.
 *
 * @returns `null` when either track has no fingerprint to compare — analysed by an
 *   older version, too short to sample, or too static to correlate. A pair that
 *   cannot be measured is left alone rather than guessed at from the averages,
 *   which is what the measurement above says they are worth.
 */
export function pairDistance(a: Track, b: Track): number | null {
  const first = a.analysis?.fingerprint ?? null;
  const second = b.analysis?.fingerprint ?? null;
  if (first === null || second === null) return null;
  return fingerprintDistance(first, second);
}

/** Same performance, or the same performance mastered again? */
function verdictFor(a: Track, b: Track): DuplicateVerdict {
  const first = a.analysis;
  const second = b.analysis;
  if (first === null || second === null) return 'same-master';

  const louder = Math.abs(first.loudnessDb - second.loudnessDb) > REMASTER_DB;
  const flatter = Math.abs(first.compression - second.compression) > REMASTER_COMPRESSION;
  return louder || flatter ? 'different-master' : 'same-master';
}

function find(parent: Map<string, string>, id: string): string {
  let root = parent.get(id) ?? id;
  while (root !== (parent.get(root) ?? root)) root = parent.get(root) ?? root;
  parent.set(id, root);
  return root;
}

function union(parent: Map<string, string>, a: string, b: string): string {
  if (!parent.has(a)) parent.set(a, a);
  if (!parent.has(b)) parent.set(b, b);
  const rootA = find(parent, a);
  const rootB = find(parent, b);
  if (rootA !== rootB) parent.set(rootB, rootA);
  return rootA;
}
