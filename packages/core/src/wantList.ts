/**
 * A list of records, against a shelf of records.
 *
 * Export your library from any streaming service and you get a few thousand lines
 * of "Artist, Title" and nothing else — no audio, no key, no tempo, nothing that
 * could be measured. It is the least interesting file in music, and it is also the
 * only one that crosses between a service and a collection you own.
 *
 * So this reads it, and answers the one question it can answer well: **which of
 * these do I already have?** Tags first; then the names this library worked out for
 * its own untagged files, which is where the audio comes in — a file called
 * `track03.mp3` matches nothing until the fingerprint has told us it is the same
 * recording as a tagged copy. See `orphans.ts`.
 *
 * What it will not do is guess what the missing ones sound like. A name carries no
 * tempo and no key, so no line of this report claims that an unheard track fills a
 * hole in the wheel or in the tempo range: that claim would be exactly the kind of
 * invented metadata this whole program exists as an alternative to. The most that
 * can be said about a missing track is what the library already knows about *other
 * records by the same artist*, and every such line says that is where it came from.
 */

import { normaliseName } from './naming.js';
import type { NameSource, ProposedName } from './orphans.js';
import type { LibraryShape } from './shape.js';
import type { Track } from './types.js';

/** One line of the list, parsed. */
export interface WantEntry {
  artist: string | null;
  title: string;
  /** The line as it arrived, so a row can be shown the way the person wrote it. */
  line: string;
}

/** How an entry was found in the library. */
export type WantVia =
  /** Matched the track's own tags. */
  | 'tags'
  /** Matched a name this library proposed for an untagged file. See `orphans.ts`. */
  | NameSource;

/**
 * What the library knows about an artist, from the copies it already has.
 *
 * Attached to *missing* entries, and the one thing that can honestly be said about
 * a record nobody here has heard: not what it is like, but what its neighbours in
 * this collection are like.
 */
export interface ArtistNote {
  artist: string;
  /** Tracks by this artist already in the library. Always one or more. */
  owned: number;
  /** Median tempo of those, or null when none of them has a reliable one. */
  medianBpm: number | null;
  /** The Camelot codes they sit in, commonest first, at most three. */
  keys: string[];
  /**
   * Set when the library's wheel is in pieces and this artist's tracks sit in one
   * of the small ones: more of them deepens a corner the rest cannot mix into.
   * Null in the ordinary case, where the wheel joins up and there is nothing to say.
   */
  island: { size: number; codes: string[] } | null;
}

export interface WantRow {
  entry: WantEntry;
  /** The file, when the library has it. */
  track: Track | null;
  via: WantVia | null;
  /** Only for a missing entry, and only when the library holds this artist. */
  artistNote: ArtistNote | null;
}

export interface WantReport {
  rows: WantRow[];
  owned: number;
  missing: number;
  /** Lines that carried no artist, which are matched on title alone and may be wrong. */
  titleOnly: number;
  /** A few sentences about the part of the list the library does hold. */
  findings: string[];
}

export interface WantOptions {
  /**
   * Names this library proposed for its untagged files. Passing them is what lets
   * a list match a file whose only evidence of identity is its sound.
   */
  names?: readonly ProposedName[];
  /** The library's shape, for the island note on missing entries. */
  shape?: LibraryShape | null;
}

/**
 * Match a list against a library.
 *
 * Order is preserved: the report is the list, annotated, so a person can read down
 * it and recognise where they are.
 */
export function matchWantList(
  entries: readonly WantEntry[],
  tracks: readonly Track[],
  options: WantOptions = {},
): WantReport {
  const index = buildIndex(tracks, options.names ?? []);
  const artists = artistIndex(tracks, options.shape ?? null);

  const rows: WantRow[] = entries.map((entry) => {
    const found = lookup(index, entry);
    if (found !== null) return { entry, track: found.track, via: found.via, artistNote: null };
    const key = entry.artist === null ? '' : normaliseName(entry.artist);
    return { entry, track: null, via: null, artistNote: artists.get(key) ?? null };
  });

  const owned = rows.filter((row) => row.track !== null);
  return {
    rows,
    owned: owned.length,
    missing: rows.length - owned.length,
    titleOnly: entries.filter((entry) => entry.artist === null).length,
    findings: describe(
      owned.map((row) => row.track).filter((track): track is Track => track !== null),
      tracks,
      rows.length,
    ),
  };
}

/** A track under one of the names it can be found by. */
interface Named {
  track: Track;
  via: WantVia;
}

interface NameIndex {
  /** `artist|title`, both folded. */
  full: Map<string, Named>;
  /** Folded title alone, for lines that carry no artist. Ambiguous titles are dropped. */
  byTitle: Map<string, Named | 'ambiguous'>;
}

/**
 * Every name every track answers to.
 *
 * A track's own tags first, so a real tag always beats a proposal; then the names
 * this library worked out for the files that have none. An untagged file with a
 * borrowed name is findable under it and nowhere else, which is the point.
 */
function buildIndex(tracks: readonly Track[], names: readonly ProposedName[]): NameIndex {
  const full = new Map<string, Named>();
  const byTitle = new Map<string, Named | 'ambiguous'>();

  const add = (track: Track, artist: string | null, title: string | null, via: WantVia): void => {
    if (title === null) return;
    const foldedTitle = normaliseName(title);
    if (foldedTitle === '') return;

    if (artist !== null) {
      const foldedArtist = normaliseName(artist);
      if (foldedArtist !== '') {
        const key = `${foldedArtist}|${foldedTitle}`;
        if (!full.has(key)) full.set(key, { track, via });
      }
    }

    const existing = byTitle.get(foldedTitle);
    if (existing === undefined) byTitle.set(foldedTitle, { track, via });
    // Two tracks with the same title and no artist to tell them apart is not a
    // match, it is a coin toss. The row stays missing and says why.
    else if (existing !== 'ambiguous' && existing.track.id !== track.id) {
      byTitle.set(foldedTitle, 'ambiguous');
    }
  };

  for (const track of tracks) {
    // A name this library gave the file is already folded into `meta` by the time
    // a track is read, so without this the report would call a guess a tag. Added
    // first, and `add` keeps the first entry for a key, so the provenance sticks.
    const given = track.given ?? null;
    if (given !== null) {
      add(track, given.artist ?? track.meta.artist, given.title ?? track.meta.title, given.source);
    }
    add(track, track.meta.artist, track.meta.title, 'tags');
  }
  for (const proposal of names) {
    add(
      proposal.track,
      proposal.artist ?? proposal.track.meta.artist,
      proposal.title ?? proposal.track.meta.title,
      proposal.source,
    );
  }
  return { full, byTitle };
}

/** The track an entry names, or null. */
function lookup(index: NameIndex, entry: WantEntry): Named | null {
  const title = normaliseName(entry.title);
  if (title === '') return null;

  if (entry.artist !== null) {
    const exact = index.full.get(`${normaliseName(entry.artist)}|${title}`);
    if (exact !== undefined) return exact;

    // A list that names every artist on the track — which is what a service export
    // writes — against a library that tagged only the first. Split before folding,
    // because folding removes the punctuation the split needs; and split only on
    // the separators a machine writes, never on `and`, which is a word inside
    // plenty of artists' own names.
    for (const part of entry.artist.split(/\s*[,;]\s*|\s+\/\s+/)) {
      const one = index.full.get(`${normaliseName(part)}|${title}`);
      if (one !== undefined) return one;
    }
    return null;
  }

  const found = index.byTitle.get(title);
  return found === undefined || found === 'ambiguous' ? null : found;
}

/** What the library holds by each artist, folded name to note. */
function artistIndex(
  tracks: readonly Track[],
  shape: LibraryShape | null,
): Map<string, ArtistNote> {
  const groups = new Map<string, { artist: string; tracks: Track[] }>();
  for (const track of tracks) {
    const artist = track.meta.artist;
    if (artist === null || artist.trim() === '') continue;
    const key = normaliseName(artist);
    if (key === '') continue;
    const group = groups.get(key) ?? { artist, tracks: [] };
    group.tracks.push(track);
    groups.set(key, group);
  }

  // Only meaningful when the wheel is in pieces; with one island there is nothing
  // to warn anybody about.
  const islands = (shape?.gaps.islands ?? []).length >= 2 ? (shape?.gaps.islands ?? []) : [];
  const biggest = islands[0];

  const notes = new Map<string, ArtistNote>();
  for (const [key, group] of groups) {
    const bpms = group.tracks
      .map((track) => track.analysis)
      .filter((analysis) => analysis !== null && analysis.bpm > 0 && analysis.bpmConfidence >= 0.3)
      .map((analysis) => analysis!.bpm)
      .sort((a, b) => a - b);

    const counts = new Map<string, number>();
    for (const track of group.tracks) {
      const code = track.analysis?.key.camelot;
      if (code === undefined) continue;
      counts.set(code, (counts.get(code) ?? 0) + 1);
    }
    const keys = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([code]) => code);

    const island =
      biggest === undefined || keys.length === 0
        ? null
        : (islands.find(
            (candidate) =>
              candidate !== biggest && keys.every((code) => candidate.codes.includes(code)),
          ) ?? null);

    notes.set(key, {
      artist: group.artist,
      owned: group.tracks.length,
      medianBpm: bpms.length === 0 ? null : Math.round(bpms[Math.floor(bpms.length / 2)] ?? 0),
      keys,
      island: island === null ? null : { size: island.count, codes: island.codes },
    });
  }
  return notes;
}

/**
 * What the matched part of the list is like, compared with the library around it.
 *
 * Each sentence is about tracks that were *heard*, never about the missing ones.
 * A list whose owned half is indistinguishable from the library gets no sentence,
 * because "these are much like your other records" is not news.
 */
function describe(owned: readonly Track[], library: readonly Track[], total: number): string[] {
  const findings: string[] = [];
  if (total === 0) return findings;

  findings.push(
    owned.length === 0
      ? `None of these ${total} are here.`
      : `${owned.length} of ${total} are already on the shelf.`,
  );
  if (owned.length < 3) return findings;

  const theirs = medianBpm(owned);
  const ours = medianBpm(library);
  if (theirs !== null && ours !== null && Math.abs(theirs - ours) >= 6) {
    findings.push(
      `The ones you have sit around ${theirs} BPM, against ${ours} for the library as a whole.`,
    );
  }

  const codes = new Set(
    owned.map((track) => track.analysis?.key.camelot).filter((code) => code !== undefined),
  );
  if (codes.size > 0 && codes.size <= 6) {
    findings.push(
      `They occupy ${codes.size} of the wheel's 24 positions: ${[...codes].join(', ')}.`,
    );
  }
  return findings;
}

/** Median tempo of the tracks that have a reliable one. */
function medianBpm(tracks: readonly Track[]): number | null {
  const bpms = tracks
    .map((track) => track.analysis)
    .filter((analysis) => analysis !== null && analysis.bpm > 0 && analysis.bpmConfidence >= 0.3)
    .map((analysis) => analysis!.bpm)
    .sort((a, b) => a - b);
  if (bpms.length === 0) return null;
  return Math.round(bpms[Math.floor(bpms.length / 2)] ?? 0);
}
