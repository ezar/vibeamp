/**
 * The files with no name.
 *
 * Every collection of any age has them: a folder of `track03.mp3` off a CD that
 * never reached a tag database, a bandcamp download that lost its tags to a
 * conversion, a rip from before anybody cared. In a tag-driven player they are
 * unreachable — not missing, just unfindable, which is worse.
 *
 * Two ways to give them a name, and both of them read something that already
 * exists rather than inventing one:
 *
 * - **By sound.** If the same recording is also in the library *with* tags — the
 *   album copy beside the compilation copy, the untagged rip beside the download —
 *   the fingerprint finds it and the name is borrowed. This is the interesting
 *   case, and it is the one that needs the audio: nothing about the two files'
 *   names or sizes says they hold the same music.
 * - **By where it sits.** `Artist/Album/03 Title.mp3` is the layout of nearly every
 *   untagged rip, because the person who made it typed the artist and album once,
 *   into the folders. See `naming.ts`.
 *
 * What this does not do is ask anybody. An acoustic lookup against an online
 * database is the obvious third source and is deliberately absent: see the
 * specification for the measurement that decided it.
 *
 * Nothing here writes to a file. A proposal is a proposal until somebody accepts
 * it, and even then it lands in this library's index, not in the file's tags.
 */

import { DUPLICATE_THRESHOLD, pairDistance } from './duplicates.js';
import { inferFromPath } from './naming.js';
import type { Track } from './types.js';

/** Where a proposed name came from. */
export type NameSource =
  /** Borrowed from a tagged copy of the same recording, found by fingerprint. */
  | 'sound'
  /** Read out of the folders the file sits in. */
  | 'path';

export interface ProposedName {
  track: Track;
  /** Only the fields the track is missing. A field it already has is null here. */
  artist: string | null;
  title: string | null;
  album: string | null;
  trackNo: number | null;
  source: NameSource;
  /** The tagged track the name was borrowed from. Null for a path reading. */
  from: Track | null;
  /** How close that track was, 0 being indistinguishable. Null for a path reading. */
  distance: number | null;
}

export interface OrphanOptions {
  /** Duration window for the fingerprint search, in seconds. See `duplicates.ts`. */
  durationToleranceSec?: number;
  /** How close a match has to be to lend its name. */
  threshold?: number;
}

const DEFAULTS = {
  durationToleranceSec: 1.5,
  threshold: DUPLICATE_THRESHOLD,
} as const;

/**
 * A file the library cannot name.
 *
 * Either half missing counts. A track with a title and no artist sorts under
 * nothing and matches no want list; a track with an artist and no title shows the
 * file name in the playlist. Both are worth fixing and both are fixed the same way.
 */
export function isOrphan(track: Track): boolean {
  return blank(track.meta.title) || blank(track.meta.artist);
}

/**
 * Propose a name for every file that has none.
 *
 * @returns One proposal per orphan that something could be said about, borrowed
 *   names first and then path readings, each group by file name. An orphan whose
 *   path says nothing beyond the file name it already shows gets no proposal: a
 *   suggestion identical to what is on screen is noise.
 */
export function proposeNames(
  tracks: readonly Track[],
  options: OrphanOptions = {},
): ProposedName[] {
  const durationTolerance = options.durationToleranceSec ?? DEFAULTS.durationToleranceSec;
  const threshold = options.threshold ?? DEFAULTS.threshold;

  const orphans = tracks.filter(isOrphan);
  if (orphans.length === 0) return [];

  // Only tracks that can actually lend something: a name, and a fingerprint to
  // prove they are the same recording.
  const donors = tracks
    .filter(
      (track) =>
        !isOrphan(track) && track.analysis?.fingerprint != null && track.durationSec !== null,
    )
    .sort((a, b) => (a.durationSec ?? 0) - (b.durationSec ?? 0));

  const proposals: ProposedName[] = [];
  for (const orphan of orphans) {
    const borrowed = borrow(orphan, donors, durationTolerance, threshold);
    if (borrowed !== null) {
      proposals.push(borrowed);
      continue;
    }
    const read = fromPath(orphan);
    if (read !== null) proposals.push(read);
  }

  return proposals.sort((a, b) => {
    if (a.source !== b.source) return a.source === 'sound' ? -1 : 1;
    if (a.source === 'sound') return (a.distance ?? 1) - (b.distance ?? 1);
    return a.track.fileName.localeCompare(b.track.fileName);
  });
}

/** The nearest tagged copy of the same recording, if the library holds one. */
function borrow(
  orphan: Track,
  donors: readonly Track[],
  durationTolerance: number,
  threshold: number,
): ProposedName | null {
  if (orphan.analysis?.fingerprint == null || orphan.durationSec === null) return null;

  let best: { track: Track; distance: number } | null = null;
  for (const donor of donors) {
    const gap = Math.abs((donor.durationSec ?? 0) - orphan.durationSec);
    // Sorted by duration, so once a donor is too long every later one is too.
    if ((donor.durationSec ?? 0) - orphan.durationSec > durationTolerance) break;
    if (gap > durationTolerance) continue;

    const distance = pairDistance(orphan, donor);
    if (distance === null || distance > threshold) continue;
    if (best === null || distance < best.distance) best = { track: donor, distance };
  }
  if (best === null) return null;

  const missing = {
    artist: blank(orphan.meta.artist) ? best.track.meta.artist : null,
    title: blank(orphan.meta.title) ? best.track.meta.title : null,
    album: blank(orphan.meta.album) ? best.track.meta.album : null,
    trackNo: orphan.meta.trackNo === null ? best.track.meta.trackNo : null,
  };
  // The donor may itself be missing whatever this one lacks, in which case there
  // is nothing to borrow and the path reading deserves its turn.
  if (missing.artist === null && missing.title === null) return null;

  return { track: orphan, ...missing, source: 'sound', from: best.track, distance: best.distance };
}

/** What the folders say, when they say more than the file name already shows. */
function fromPath(orphan: Track): ProposedName | null {
  const read = inferFromPath(orphan.relPath);
  const artist = blank(orphan.meta.artist) ? read.artist : null;
  const title = blank(orphan.meta.title) ? read.title : null;
  const album = blank(orphan.meta.album) ? read.album : null;
  const trackNo = orphan.meta.trackNo === null ? read.trackNo : null;

  // An artist is the price of admission. A title read off a path is only the file
  // name with the extension gone, which the playlist already shows; and a lone
  // parent folder is as likely to be `unsorted`, `Downloads` or `Music` as it is
  // to be an album, so an album on its own is not evidence of anything. Requiring
  // the artist means requiring either `Artist - Title.mp3` or two levels of
  // folder, which is what a rip actually looks like.
  if (artist === null) return null;

  return {
    track: orphan,
    artist,
    title,
    album,
    trackNo,
    source: 'path',
    from: null,
    distance: null,
  };
}

function blank(value: string | null): boolean {
  return value === null || value.trim() === '';
}

/**
 * A track with its given name folded into the fields the tags left empty.
 *
 * Applied where the library is read rather than where it is written, so the whole
 * program — the playlist, the X-ray, the want list, the auto-DJ — sees one name per
 * file and none of them has to know where it came from. The `given` record stays on
 * the track, so the places that care can still say "this name was worked out, not
 * read".
 *
 * A real tag always wins. Accepting a proposal never overwrites one.
 */
export function withGivenName(track: Track): Track {
  const given = track.given ?? null;
  if (given === null) return track;

  return {
    ...track,
    meta: {
      ...track.meta,
      artist: blank(track.meta.artist) ? given.artist : track.meta.artist,
      title: blank(track.meta.title) ? given.title : track.meta.title,
      album: blank(track.meta.album) ? given.album : track.meta.album,
      trackNo: track.meta.trackNo ?? given.trackNo,
    },
  };
}
