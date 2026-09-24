/**
 * A list against a shelf.
 *
 * Two kinds of test here. One kind checks that the matching finds what is there,
 * including through the borrowed names — the case a tag-driven tool cannot reach.
 * The other checks the report's restraint: that nothing in it claims to know
 * anything about a record the library has never heard.
 */

import { describe, expect, it } from 'vitest';
import { matchWantList } from '../wantList.js';
import { proposeNames } from '../orphans.js';
import { splitArtistTitle } from '../naming.js';
import { libraryShape } from '../shape.js';
import { makeTrack } from './tracks.js';
import type { WantEntry } from '../wantList.js';

/** A list line, split the way the app's own parser splits one. */
function want(line: string): WantEntry {
  return { ...splitArtistTitle(line), line };
}

const library = [
  makeTrack({ id: '1', title: 'Debaser', artist: 'Pixies', bpm: 128 }),
  makeTrack({ id: '2', title: 'Here Comes Your Man', artist: 'Pixies', bpm: 120 }),
  makeTrack({ id: '3', title: 'Breadcrumb Trail', artist: 'Slint', bpm: 96 }),
];

describe('matching', () => {
  it('reports what is owned and what is not, in the order given', () => {
    const report = matchWantList([want('Pixies - Debaser'), want('Wire - Ex Lion Tamer')], library);

    expect(report.owned).toBe(1);
    expect(report.missing).toBe(1);
    expect(report.rows[0]?.track?.id).toBe('1');
    expect(report.rows[0]?.via).toBe('tags');
    expect(report.rows[1]?.track).toBeNull();
  });

  it('matches through the spellings two taggers disagree about', () => {
    const report = matchWantList(
      [want('PIXIES - Debaser (2017 Remaster)'), want('Pixies - Here Comes Your Man - Live')],
      library,
    );
    expect(report.rows[0]?.track?.id).toBe('1');
    // A live version is another performance. Not owned, and not reported as owned.
    expect(report.rows[1]?.track).toBeNull();
  });

  it('matches when the list names every artist and the tags name one', () => {
    const report = matchWantList([want('Pixies, Kim Deal - Debaser')], library);
    expect(report.rows[0]?.track?.id).toBe('1');
  });

  it('refuses a title that two tracks answer to', () => {
    const twice = [
      makeTrack({ id: 'a', title: 'Untitled', artist: 'One' }),
      makeTrack({ id: 'b', title: 'Untitled', artist: 'Two' }),
    ];
    const report = matchWantList([want('Untitled')], twice);
    // A coin toss is not a match. The row stays missing.
    expect(report.rows[0]?.track).toBeNull();
    expect(report.titleOnly).toBe(1);
  });

  it('finds a file whose only claim to a name came from its sound', () => {
    const tracks = [
      makeTrack({ id: 'tagged', title: 'Debaser', artist: 'Pixies', seed: 5 }),
      makeTrack({ id: 'orphan', relPath: 'x/t7.mp3', title: null, artist: null, seed: 5 }),
    ];
    // The tagged copy is removed from the shelf: all that is left of this record
    // is a file called t7.mp3, which no tag-driven tool can match to anything.
    const onlyOrphan = tracks.filter((track) => track.id === 'orphan');
    const names = proposeNames(tracks);

    expect(matchWantList([want('Pixies - Debaser')], onlyOrphan).owned).toBe(0);
    expect(matchWantList([want('Pixies - Debaser')], onlyOrphan, { names }).owned).toBe(1);
    expect(matchWantList([want('Pixies - Debaser')], onlyOrphan, { names }).rows[0]?.via).toBe(
      'sound',
    );
  });

  it('still says where an accepted name came from', () => {
    // Accepting a proposal folds it into the track's own fields, so without care
    // the report would call a guess a tag — and a want list built on guesses that
    // present themselves as tags is the thing this whole program is against.
    const named = makeTrack({ id: 'a', relPath: 'x/t7.mp3', title: null, artist: null });
    const report = matchWantList(
      [want('Pixies - Debaser')],
      [
        {
          ...named,
          meta: { ...named.meta, artist: 'Pixies', title: 'Debaser' },
          given: {
            artist: 'Pixies',
            title: 'Debaser',
            album: null,
            trackNo: null,
            source: 'sound',
            at: 1,
          },
        },
      ],
    );
    expect(report.rows[0]?.via).toBe('sound');
  });

  it('lets a real tag win over a proposal', () => {
    const tracks = [
      makeTrack({
        id: 'a',
        relPath: 'Wire/Pink Flag/01 Reuters.mp3',
        title: 'Reuters',
        artist: 'Wire',
      }),
    ];
    const report = matchWantList([want('Wire - Reuters')], tracks, { names: proposeNames(tracks) });
    expect(report.rows[0]?.via).toBe('tags');
  });
});

describe('what it refuses to say', () => {
  it('never puts a tempo or a key on a record it has not heard', () => {
    const report = matchWantList([want('Wire - Ex Lion Tamer')], library);
    const [row] = report.rows;
    expect(row?.track).toBeNull();
    // The only thing attached to a missing row is what the library knows about
    // other records by the same artist — and here it knows none.
    expect(row?.artistNote).toBeNull();
  });

  it('places a missing record only by the copies it already has of that artist', () => {
    const report = matchWantList([want('Pixies - Monkey Gone to Heaven')], library);
    const note = report.rows[0]?.artistNote;
    expect(note?.owned).toBe(2);
    expect(note?.medianBpm).toBe(128);
    expect(note?.keys).toEqual(['8B']);
  });

  it('warns when more of an artist lands in a corner of the wheel nothing reaches', () => {
    // Two groups on the wheel with no move between them: 8B/9B on one side, 2A on
    // the other. The artist to look up sits alone in the small one.
    const split = [
      makeTrack({ id: 'a', title: 'One', artist: 'Main', root: 'C', scale: 'major' }),
      makeTrack({ id: 'b', title: 'Two', artist: 'Main', root: 'G', scale: 'major' }),
      makeTrack({ id: 'c', title: 'Three', artist: 'Far', root: 'D#', scale: 'minor' }),
    ];
    const report = matchWantList([want('Far - Four')], split, { shape: libraryShape(split) });
    const note = report.rows[0]?.artistNote;
    expect(note?.island?.codes).toEqual(['2A']);
    expect(note?.island?.size).toBe(1);
  });

  it('says nothing about islands when the wheel joins up', () => {
    const report = matchWantList([want('Pixies - Monkey Gone to Heaven')], library, {
      shape: libraryShape(library),
    });
    expect(report.rows[0]?.artistNote?.island).toBeNull();
  });

  it('describes the part it has heard, and counts the part it has not', () => {
    const entries = [
      want('Pixies - Debaser'),
      want('Pixies - Here Comes Your Man'),
      want('Slint - Breadcrumb Trail'),
      want('Wire - Ex Lion Tamer'),
    ];
    const report = matchWantList(entries, library);
    expect(report.findings[0]).toBe('3 of 4 are already on the shelf.');
    expect(report.findings.join(' ')).not.toContain('Ex Lion Tamer');
  });
});
