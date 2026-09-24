/**
 * Naming the files that have no name.
 *
 * The test that matters is the one where the two copies share nothing but their
 * sound: different folders, different file names, different sizes. Every
 * tag-driven tool in existence gets that case wrong, and it is the only reason
 * this feature needs a fingerprint rather than a directory listing.
 */

import { describe, expect, it } from 'vitest';
import { isOrphan, proposeNames } from '../orphans.js';
import { makeTrack } from './tracks.js';

describe('spotting an orphan', () => {
  it('counts a missing half as missing', () => {
    expect(isOrphan(makeTrack({ id: 'a', title: 'Debaser', artist: 'Pixies' }))).toBe(false);
    expect(isOrphan(makeTrack({ id: 'b', title: 'Debaser', artist: null }))).toBe(true);
    expect(isOrphan(makeTrack({ id: 'c', title: null, artist: 'Pixies' }))).toBe(true);
    expect(isOrphan(makeTrack({ id: 'd', title: '   ', artist: 'Pixies' }))).toBe(true);
  });
});

describe('borrowing a name from the sound', () => {
  it('names an untagged file after a tagged copy of the same recording', () => {
    const proposals = proposeNames([
      makeTrack({
        id: 'tagged',
        relPath: 'Pixies/Doolittle/03 Debaser.mp3',
        title: 'Debaser',
        artist: 'Pixies',
        album: 'Doolittle',
        seed: 1,
      }),
      makeTrack({
        id: 'orphan',
        relPath: 'unsorted/t3.mp3',
        title: null,
        artist: null,
        durationSec: 200.4,
        seed: 1,
      }),
    ]);

    expect(proposals).toHaveLength(1);
    const [first] = proposals;
    expect(first?.track.id).toBe('orphan');
    expect(first?.source).toBe('sound');
    expect(first?.title).toBe('Debaser');
    expect(first?.artist).toBe('Pixies');
    expect(first?.from?.id).toBe('tagged');
  });

  it('will not lend a name across two different recordings', () => {
    const proposals = proposeNames([
      makeTrack({ id: 'tagged', title: 'Debaser', artist: 'Pixies', seed: 1 }),
      makeTrack({ id: 'orphan', relPath: 'x/t3.mp3', title: null, artist: null, seed: 2 }),
    ]);
    // Same length, same everything but the music. A duration-and-size matcher
    // would have paired these.
    expect(proposals).toHaveLength(0);
  });

  it('will not lend a name across a length no encoder explains', () => {
    const proposals = proposeNames([
      makeTrack({ id: 'tagged', title: 'Debaser', artist: 'Pixies', seed: 1 }),
      makeTrack({
        id: 'orphan',
        relPath: 'x/t3.mp3',
        title: null,
        artist: null,
        durationSec: 260,
        seed: 1,
      }),
    ]);
    expect(proposals).toHaveLength(0);
  });

  it('fills only the half that is missing', () => {
    const proposals = proposeNames([
      makeTrack({ id: 'tagged', title: 'Debaser', artist: 'Pixies', album: 'Doolittle', seed: 1 }),
      makeTrack({ id: 'orphan', relPath: 'x/t3.mp3', title: 'Debaser', artist: null, seed: 1 }),
    ]);
    const [first] = proposals;
    expect(first?.artist).toBe('Pixies');
    // Already had one, so nothing is proposed for it: a proposal to replace a tag
    // is a different and much more dangerous feature.
    expect(first?.title).toBeNull();
  });
});

describe('reading a name off the path', () => {
  it('falls back to the folders when nothing sounds like it', () => {
    const proposals = proposeNames([
      makeTrack({
        id: 'orphan',
        relPath: 'Pixies/Doolittle/03 Debaser.mp3',
        title: null,
        artist: null,
      }),
    ]);
    const [first] = proposals;
    expect(first?.source).toBe('path');
    expect(first?.artist).toBe('Pixies');
    expect(first?.album).toBe('Doolittle');
    expect(first?.title).toBe('Debaser');
    expect(first?.trackNo).toBe(3);
  });

  it('says nothing when the path says nothing', () => {
    // `track03` is what the playlist already shows. Offering it back as a
    // proposal would be a row of noise.
    expect(
      proposeNames([makeTrack({ id: 'x', relPath: 'track03.mp3', title: null, artist: null })]),
    ).toEqual([]);
  });

  it('does not mistake a lone folder for an album', () => {
    // `unsorted`, `Downloads`, `Music`: one level of folder is not an album, and
    // proposing it would put the same wrong album on a few hundred files.
    expect(
      proposeNames([makeTrack({ id: 'x', relPath: 'unsorted/t3.mp3', title: null, artist: null })]),
    ).toEqual([]);
  });

  it('puts the borrowed names first, nearest match at the top', () => {
    const proposals = proposeNames([
      makeTrack({ id: 'tagged', title: 'Debaser', artist: 'Pixies', seed: 1 }),
      makeTrack({ id: 'heard', relPath: 'x/t3.mp3', title: null, artist: null, seed: 1 }),
      makeTrack({
        id: 'read',
        relPath: 'Slint/Spiderland/01 Breadcrumb.mp3',
        title: null,
        artist: null,
      }),
    ]);
    expect(proposals.map((proposal) => proposal.source)).toEqual(['sound', 'path']);
  });
});
