/**
 * The tracks a record does not stop between.
 *
 * The thresholds are measured in `packages/analysis`; this is about the rule built
 * on them, and most of it is about what the rule refuses. Missing a join plays a
 * record the way every other player already does. Inventing one glues two unrelated
 * tracks together, which is a thing no player has ever done to somebody's music and
 * a thing they would notice immediately.
 */

import { describe, expect, it } from 'vitest';
import { findSegues, runsInto, segueSideOf } from '../segue.js';
import { makeTrack } from './tracks.js';
import type { Track } from '../types.js';

/** A track at a position on a record, with the two edge levels that decide a join. */
function onRecord(spec: {
  id: string;
  folder?: string;
  album?: string | null;
  trackNo?: number | null;
  fileName?: string;
  head?: number;
  tail?: number;
}): Track {
  const folder = spec.folder ?? 'Pixies/Doolittle';
  const fileName = spec.fileName ?? `${String(spec.trackNo ?? 1).padStart(2, '0')} ${spec.id}.mp3`;
  const track = makeTrack({
    id: spec.id,
    relPath: `${folder}/${fileName}`,
    album: spec.album === undefined ? 'Doolittle' : spec.album,
    trackNo: spec.trackNo ?? null,
  });
  if (track.analysis === null) throw new Error('the fixture should be analysed');
  return {
    ...track,
    analysis: { ...track.analysis, headRatio: spec.head ?? 0.9, tailRatio: spec.tail ?? 0.9 },
  };
}

const side = (track: Track) => segueSideOf(track);

describe('a join', () => {
  it('is two neighbours on one record, one ending at level and the next starting there', () => {
    const first = onRecord({ id: 'a', trackNo: 3, tail: 0.9 });
    const second = onRecord({ id: 'b', trackNo: 4, head: 0.9 });
    expect(runsInto(side(first), side(second))).toBe(true);
  });

  it('runs one way only', () => {
    const first = onRecord({ id: 'a', trackNo: 3 });
    const second = onRecord({ id: 'b', trackNo: 4 });
    // The second half running back into the first is not a thing that happens.
    expect(runsInto(side(second), side(first))).toBe(false);
  });

  it('is not two tracks that merely both start and end at level', () => {
    // Different records. Plenty of music stops dead and plenty opens in full flow;
    // two unrelated tracks doing both is a coincidence, not a join.
    const first = onRecord({ id: 'a', folder: 'Pixies/Doolittle', trackNo: 3 });
    const second = onRecord({
      id: 'b',
      folder: 'Slint/Spiderland',
      album: 'Spiderland',
      trackNo: 4,
    });
    expect(runsInto(side(first), side(second))).toBe(false);
  });

  it('is not two neighbours where the first fades out', () => {
    const first = onRecord({ id: 'a', trackNo: 3, tail: 0.04 });
    const second = onRecord({ id: 'b', trackNo: 4, head: 0.9 });
    expect(runsInto(side(first), side(second))).toBe(false);
  });

  it('is not two neighbours where the second fades in', () => {
    // The case that must never be got wrong: a fade is how a record begins, and
    // cutting into one would be audible on every play.
    const first = onRecord({ id: 'a', trackNo: 3, tail: 0.9 });
    const second = onRecord({ id: 'b', trackNo: 4, head: 0.28 });
    expect(runsInto(side(first), side(second))).toBe(false);
  });

  it('is not two tracks with a track missing between them', () => {
    const first = onRecord({ id: 'a', trackNo: 3 });
    const third = onRecord({ id: 'c', trackNo: 5 });
    expect(runsInto(side(first), side(third))).toBe(false);
  });

  it('works on a rip with no tags at all, from the numbers in the file names', () => {
    const first = onRecord({ id: 'a', album: null, trackNo: null, fileName: '03 track.mp3' });
    const second = onRecord({ id: 'b', album: null, trackNo: null, fileName: '04 track.mp3' });
    expect(runsInto(side(first), side(second))).toBe(true);

    const apart = onRecord({ id: 'c', album: null, trackNo: null, fileName: '06 track.mp3' });
    expect(runsInto(side(second), side(apart))).toBe(false);
  });

  it('does not join two records that happen to share a folder and a numbering', () => {
    // A flat folder with two albums in it. The numbers line up and the albums do
    // not, which is exactly the case the album check is there for.
    const first = onRecord({ id: 'a', folder: 'music', album: 'One', fileName: 'One - 03.mp3' });
    const second = onRecord({ id: 'b', folder: 'music', album: 'Two', fileName: 'Two - 04.mp3' });
    expect(runsInto(side(first), side(second))).toBe(false);
  });

  it('says nothing about a track that has not been analysed', () => {
    const pending = makeTrack({ id: 'x', analysed: false });
    expect(runsInto(side(onRecord({ id: 'a', trackNo: 3 })), side(pending))).toBe(false);
    expect(segueSideOf(pending)).toBeNull();
  });
});

describe('finding them in a library', () => {
  it('lists the pairs in the order the record plays them', () => {
    const tracks = [
      onRecord({ id: 'one', trackNo: 1, tail: 0.04 }),
      onRecord({ id: 'two', trackNo: 2, head: 0.9, tail: 0.9 }),
      onRecord({ id: 'three', trackNo: 3, head: 0.9, tail: 0.9 }),
      onRecord({ id: 'four', trackNo: 4, head: 0.9, tail: 0.04 }),
      onRecord({ id: 'five', trackNo: 5, head: 0.02 }),
    ];
    // Two into three into four is one run of three tracks, reported as its two
    // joins. One fades out, and five fades in.
    expect(findSegues(tracks).map((pair) => [pair.from.id, pair.to.id])).toEqual([
      ['two', 'three'],
      ['three', 'four'],
    ]);
  });

  it('keeps each record to itself', () => {
    const tracks = [
      onRecord({ id: 'a', trackNo: 9 }),
      onRecord({ id: 'b', folder: 'Slint/Spiderland', album: 'Spiderland', trackNo: 10 }),
    ];
    expect(findSegues(tracks)).toEqual([]);
  });
});
