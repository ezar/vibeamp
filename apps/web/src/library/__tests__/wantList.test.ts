/**
 * Reading a list in whatever shape it arrived in.
 *
 * The three formats are not a checklist of features; they are the three ways a
 * list actually reaches a person. A service export is a CSV with quoted cells, an
 * old drive holds `.m3u` files, and everything else is pasted into a box. A parser
 * that handled only the tidy one would push the conversion onto the user.
 */

import { describe, expect, it } from 'vitest';
import { parseWantList } from '../wantList.js';

describe('a service export', () => {
  it('reads the columns an export tool writes', () => {
    const csv = [
      '"Track URI","Track Name","Artist Name(s)","Album Name"',
      '"spotify:track:1","Debaser","Pixies","Doolittle"',
      '"spotify:track:2","Here Comes Your Man","Pixies","Doolittle"',
    ].join('\n');

    expect(parseWantList(csv)).toEqual([
      { artist: 'Pixies', title: 'Debaser', line: 'Pixies — Debaser' },
      { artist: 'Pixies', title: 'Here Comes Your Man', line: 'Pixies — Here Comes Your Man' },
    ]);
  });

  it('keeps a comma that lives inside a cell', () => {
    const csv = ['Title,Artist', '"Everything, Everything","A Band"'].join('\n');
    expect(parseWantList(csv)[0]).toEqual({
      artist: 'A Band',
      title: 'Everything, Everything',
      line: 'A Band — Everything, Everything',
    });
  });

  it('takes the first of several artists in one cell', () => {
    const csv = ['Track Name,Artist Name(s)', 'Debaser,"Pixies, Kim Deal"'].join('\n');
    expect(parseWantList(csv)[0]?.artist).toBe('Pixies');
  });

  it('reads a doubled quote as the one quote it stands for', () => {
    const csv = ['Title,Artist', '"The ""Real"" Thing",A Band'].join('\n');
    expect(parseWantList(csv)[0]?.title).toBe('The "Real" Thing');
  });

  it('survives a file with no artist column at all', () => {
    const csv = ['Title,Album', 'Debaser,Doolittle'].join('\n');
    expect(parseWantList(csv)[0]).toEqual({ artist: null, title: 'Debaser', line: 'Debaser' });
  });
});

describe('a playlist', () => {
  it('reads the names out of the EXTINF lines', () => {
    const m3u = ['#EXTM3U', '#EXTINF:190,Pixies - Debaser', 'music/03.mp3'].join('\n');
    expect(parseWantList(m3u)).toEqual([
      { artist: 'Pixies', title: 'Debaser', line: 'Pixies - Debaser' },
    ]);
  });

  it('falls back to the file name when a playlist carries no EXTINF', () => {
    const m3u = ['#EXTM3U', 'music/Pixies - Debaser.mp3'].join('\n');
    expect(parseWantList(m3u)[0]).toEqual({
      artist: 'Pixies',
      title: 'Debaser',
      line: 'Pixies - Debaser',
    });
  });
});

describe('pasted text', () => {
  it('takes one entry per line', () => {
    const text = 'Pixies - Debaser\n\nSlint – Breadcrumb Trail\nUntitled\n';
    expect(parseWantList(text)).toEqual([
      { artist: 'Pixies', title: 'Debaser', line: 'Pixies - Debaser' },
      { artist: 'Slint', title: 'Breadcrumb Trail', line: 'Slint – Breadcrumb Trail' },
      { artist: null, title: 'Untitled', line: 'Untitled' },
    ]);
  });

  it('does not read a comma in a pasted line as a second column', () => {
    // No header naming a title, so this is text with a comma in it, not a table.
    const text = 'Pixies - Debaser, Live at Brixton';
    expect(parseWantList(text)).toEqual([
      {
        artist: 'Pixies',
        title: 'Debaser, Live at Brixton',
        line: 'Pixies - Debaser, Live at Brixton',
      },
    ]);
  });

  it('keeps the same track twice when the list has it twice', () => {
    // The counts in the report have to agree with what the person pasted.
    expect(parseWantList('A - B\nA - B')).toHaveLength(2);
  });

  it('reads an empty file as an empty list rather than an error', () => {
    expect(parseWantList('   \n\n')).toEqual([]);
  });
});
