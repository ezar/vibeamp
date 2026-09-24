/**
 * What two spellings of one track are allowed to disagree about.
 *
 * The risk here runs both ways and the tests are split accordingly. Folding too
 * little leaves a want list matching nothing, which is a feature that does not
 * work; folding too much reports a live album as owned because a studio track
 * shares its name, which is a feature that lies.
 */

import { describe, expect, it } from 'vitest';
import { inferFromPath, normaliseName, splitArtistTitle } from '../naming.js';

describe('folding a name', () => {
  it('ignores case, accents and punctuation', () => {
    expect(normaliseName('Björk')).toBe(normaliseName('bjork'));
    expect(normaliseName("Don't Stop Me Now")).toBe(normaliseName('Dont Stop Me Now'));
    expect(normaliseName('Simon & Garfunkel')).toBe(normaliseName('Simon and Garfunkel'));
  });

  it('ignores the edition a streaming service prints and a ripper does not', () => {
    expect(normaliseName('Paranoid Android - 2017 Remaster')).toBe(
      normaliseName('Paranoid Android'),
    );
    expect(normaliseName('Blue Monday (Radio Edit)')).toBe(normaliseName('Blue Monday'));
    expect(normaliseName('Roads (Album Version)')).toBe(normaliseName('Roads'));
  });

  it('ignores featured artists, which one side names and the other does not', () => {
    expect(normaliseName('Blinding Light feat. Someone')).toBe(normaliseName('Blinding Light'));
    expect(normaliseName('Blinding Light (ft. Someone Else)')).toBe(
      normaliseName('Blinding Light'),
    );
  });

  it('keeps a live version apart from the studio take', () => {
    // Not an oversight: a live recording is different music, and reporting it as
    // owned would be the report claiming something that is not true.
    expect(normaliseName('Debaser (Live)')).not.toBe(normaliseName('Debaser'));
  });

  it('folds a name that is nothing but edition noise to the empty string', () => {
    // Which the caller must never treat as a match, or every such track matches
    // every other one.
    expect(normaliseName('(2011 Remaster)')).toBe('');
  });
});

describe('splitting a line', () => {
  it('takes the first separator, whichever dash was typed', () => {
    expect(splitArtistTitle('Pixies - Debaser')).toEqual({ artist: 'Pixies', title: 'Debaser' });
    expect(splitArtistTitle('Pixies – Debaser')).toEqual({ artist: 'Pixies', title: 'Debaser' });
    expect(splitArtistTitle('Pixies — Debaser')).toEqual({ artist: 'Pixies', title: 'Debaser' });
    expect(splitArtistTitle('Pixies - Debaser - Live')).toEqual({
      artist: 'Pixies',
      title: 'Debaser - Live',
    });
  });

  it('leaves a hyphenated title alone when there is no separator to find', () => {
    expect(splitArtistTitle('Anti-Hero')).toEqual({ artist: null, title: 'Anti-Hero' });
  });
});

describe('reading a name out of a path', () => {
  it('reads the layout nearly every untagged rip uses', () => {
    expect(inferFromPath('Pixies/Doolittle/03 Debaser.mp3')).toEqual({
      artist: 'Pixies',
      album: 'Doolittle',
      title: 'Debaser',
      trackNo: 3,
    });
  });

  it('reads an artist and album folded into one folder name', () => {
    expect(inferFromPath('Pixies - Doolittle/03 - Debaser.flac')).toEqual({
      artist: 'Pixies',
      album: 'Doolittle',
      title: 'Debaser',
      trackNo: 3,
    });
  });

  it('lets the file name overrule the folder it sits in', () => {
    const read = inferFromPath('Mixes/Various/Pixies - Debaser.mp3');
    expect(read.artist).toBe('Pixies');
    expect(read.title).toBe('Debaser');
  });

  it('says nothing it was not told', () => {
    const read = inferFromPath('track03.mp3');
    expect(read.artist).toBeNull();
    expect(read.album).toBeNull();
    expect(read.trackNo).toBeNull();
    expect(read.title).toBe('track03');
  });

  it('drops a disc prefix as well as a track number', () => {
    expect(inferFromPath('Artist/Album/1-05 Title.mp3').trackNo).toBe(5);
  });
});
