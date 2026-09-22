/**
 * What is wrong with the files themselves.
 *
 * The X-ray describes the music. This describes the collection as a set of files,
 * which is a different question and the one nobody else answers: a service has no
 * files to be wrong, and a tag editor cannot hear that a channel is missing.
 *
 * Everything here is a measurement with a threshold, and every threshold was taken
 * from a measurement rather than chosen — see
 * `packages/analysis/src/__tests__/health.test.ts`, which runs the real pipeline
 * over signals built to sit either side of each one.
 *
 * Two rules it keeps. It never says "broken" where it means "unusual", because a
 * track that stops dead on a beat is a genre and not a defect. And it states what
 * it cannot see, because a health report with silent blind spots is worse than no
 * health report: it makes the absence of a finding mean something it does not.
 */

import type { Track } from './types.js';

/**
 * The analysis version that first measured the fields these checks read.
 *
 * A track analysed before it keeps its old descriptors until it is re-analysed —
 * the repository marks it pending without discarding what it has, so the player
 * keeps working meanwhile. Those records have no tail, no clipping and no side
 * ratio, and reading them as zeros would report a library nobody has checked yet
 * as a library with nothing wrong. So they are counted as not yet checked, and the
 * number climbs on its own as the re-analysis runs.
 */
const HEALTH_SINCE_VERSION = 3;

export type HealthIssue =
  /** The browser could not decode it at all. */
  | 'undecodable'
  /** The analysis failed and was given up on. */
  | 'failed'
  /** Analysed, and there is essentially nothing in it. */
  | 'silent'
  /** Two channels carrying one signal: mono in a stereo container. */
  | 'fake-stereo'
  /** Ends at full level. Cut short, or a track that stops dead. */
  | 'abrupt-end'
  /** Peaks flattened against the ceiling. */
  | 'clipped';

export interface HealthFinding {
  issue: HealthIssue;
  /** What it is and what it means, in one line. */
  summary: string;
  /** The files, worst first where the measure has an order. */
  tracks: Track[];
}

export interface LibraryHealth {
  /** Tracks in the library. */
  total: number;
  /** Tracks the file checks could run on: analysed by a version that measures them. */
  checked: number;
  /**
   * Tracks holding descriptors from before these checks existed.
   *
   * Not a problem, and not silence either: they are waiting their turn in a
   * re-analysis, and until then nothing here has looked at them.
   */
  awaitingReanalysis: number;
  /** Distinct tracks carrying at least one finding. */
  affected: number;
  findings: HealthFinding[];
  /**
   * What this cannot see.
   *
   * Stated because a report that lists six things and stays quiet about the
   * seventh invites the reader to conclude the seventh is fine.
   */
  blindSpots: string[];
}

/**
 * Mean level below which a track is called silent, in dBFS.
 *
 * Music sits between roughly −20 and −8. −45 is three orders of magnitude below
 * that: a failed rip, a file of digital black, or a track that is nothing but room
 * tone. It is deliberately far from anything a quiet recording reaches.
 */
const SILENT_DBFS = -45;

/**
 * Side-over-mid below which two channels are called the same signal.
 *
 * Measured: bit-identical channels give exactly 0.00000, a deliberately absurd
 * 97/3 blend gives 0.02071, an ordinary stereo mix 0.27127. The threshold sits
 * four times below the narrowest of those rather than halfway, because the cost of
 * the two mistakes is not symmetric: missing a mono file wastes some disk, and
 * calling somebody's narrow mix a defect is simply wrong.
 */
const FAKE_STEREO_SIDE = 0.005;

/**
 * Tail level, over the track's own mean, above which the end is called abrupt.
 *
 * Measured: a fade-out lands at 0.039, a note released at the end at 0.012, a
 * track cut mid-bar at 0.780. 0.5 sits in that gap with room on both sides.
 */
const ABRUPT_TAIL = 0.5;

/**
 * Share of the signal in flat-topped peaks above which a track is called clipped.
 *
 * Measured: a loud master that is not clipped reaches 0.00000, one driven 6 dB
 * into the ceiling 0.00990, one driven 12 dB in 0.09180. A thousandth is above the
 * first and well below the second.
 */
const CLIPPED_SHARE = 0.001;

/** How many files a finding names before the rest are counted rather than listed. */
export const HEALTH_TRACKS_SHOWN = 8;

/**
 * Check a library.
 *
 * @param tracks Every track, whatever its status. The ones that never analysed are
 *   findings in their own right rather than omissions.
 */
export function libraryHealth(tracks: readonly Track[]): LibraryHealth {
  const withDescriptors = tracks.filter((track) => track.analysis !== null);
  const analysed = withDescriptors.filter((track) => track.analysisVersion >= HEALTH_SINCE_VERSION);
  const findings: HealthFinding[] = [];
  const affected = new Set<string>();

  const add = (issue: HealthIssue, summary: string, found: Track[]): void => {
    if (found.length === 0) return;
    findings.push({ issue, summary, tracks: found });
    for (const track of found) affected.add(track.id);
  };

  add(
    'undecodable',
    'This browser has no decoder for these. Another browser may; converting them certainly will.',
    tracks.filter((track) => track.status === 'unsupported'),
  );

  add(
    'failed',
    'Decoded, then the analysis failed and was given up on. Usually a truncated or corrupt file.',
    tracks.filter((track) => track.status === 'failed'),
  );

  const silent = analysed.filter((track) => (track.analysis?.loudnessDb ?? 0) < SILENT_DBFS);
  const silentIds = new Set(silent.map((track) => track.id));
  add(
    'silent',
    'Almost no signal at all. A failed rip leaves a file of the right length and nothing in it.',
    [...silent].sort((a, b) => (a.analysis?.loudnessDb ?? 0) - (b.analysis?.loudnessDb ?? 0)),
  );

  // Every measure below this point is meaningless on a file with nothing in it:
  // two channels of silence are identical, silence ends as loudly as it began, and
  // none of it clips. Reported alongside `silent`, one broken file would look like
  // four, and the count of affected files would be the only honest thing left.
  const measurable = analysed.filter((track) => !silentIds.has(track.id));

  add(
    'fake-stereo',
    'Two channels carrying the same signal: mono in a stereo container, at twice the size.',
    measurable.filter((track) => {
      const side = track.analysis?.sideRatio;
      return side !== null && side !== undefined && side < FAKE_STEREO_SIDE;
    }),
  );

  add(
    'abrupt-end',
    'Ends at full level instead of decaying. Often a truncated download — but some music does stop dead.',
    [...analysed]
      // A silent file's tail is as loud as its mean, which is to say both are
      // nothing. It is already reported above, and saying it twice in different
      // words would make one defect look like two.
      .filter((track) => !silentIds.has(track.id) && (track.analysis?.tailRatio ?? 0) > ABRUPT_TAIL)
      .sort((a, b) => (b.analysis?.tailRatio ?? 0) - (a.analysis?.tailRatio ?? 0)),
  );

  add(
    'clipped',
    'Peaks flattened against the ceiling. The loudness can be turned down; what it cost cannot be put back.',
    [...measurable]
      .filter((track) => (track.analysis?.clippedRatio ?? 0) > CLIPPED_SHARE)
      .sort((a, b) => (b.analysis?.clippedRatio ?? 0) - (a.analysis?.clippedRatio ?? 0)),
  );

  return {
    total: tracks.length,
    checked: analysed.length,
    awaitingReanalysis: withDescriptors.length - analysed.length,
    affected: affected.size,
    findings,
    blindSpots: blindSpots(analysed),
  };
}

/**
 * What the checks above are structurally unable to find.
 *
 * Only stated where it could apply: telling somebody their mono files might be
 * secretly transcoded is noise when they have no mono files.
 */
function blindSpots(analysed: readonly Track[]): string[] {
  const spots: string[] = [];

  // The most-wanted check, and the one the ordinary analysis cannot make: it runs
  // at 16 kHz, so everything above 8 kHz — exactly where a lossy encoder's cutoff
  // lives — is gone before any descriptor sees it. Worded as a pointer rather than
  // as an impossibility, because the second decode below does reach it, and a line
  // that reads "cannot be seen" would be false the moment somebody ran it.
  spots.push(
    'The analysis runs at 16 kHz, so a file re-encoded from a lossy source is invisible to it: an encoder’s fingerprint is in the octave above that. The deep check reads it.',
  );

  if (analysed.some((track) => (track.analysis?.clippedRatio ?? 0) > 0)) {
    spots.push(
      'Clipping is counted after a resample that blunts the flat tops it looks for. What it found is real; what it missed may still be there.',
    );
  }

  if (analysed.some((track) => track.analysis?.sideRatio === null)) {
    spots.push('A file that is already one channel is left alone: there is nothing to compare.');
  }

  if (analysed.some((track) => track.analysis?.sideRatio !== null)) {
    // Everything except the side ratio is measured after the downmix, so a defect
    // in one channel is averaged against a clean one and can vanish entirely.
    spots.push(
      'A fault in one channel only can hide: every measure but the stereo one is taken after the two are mixed down to one.',
    );
  }

  return spots;
}
