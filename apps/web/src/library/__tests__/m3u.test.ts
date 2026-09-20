import { describe, expect, it } from 'vitest';
import { buildM3u, matchEntry, normalise, parseM3u } from '../m3u.js';

const track = (relPath: string) => ({
  relPath,
  fileName: relPath.slice(relPath.lastIndexOf('/') + 1),
});

function indexes(paths: readonly string[]) {
  const tracks = paths.map(track);
  return {
    byRelPath: new Map(tracks.map((t) => [t.relPath, t])),
    byFileName: new Map(tracks.map((t) => [t.fileName, t])),
  };
}

describe('parseM3u', () => {
  it('reads a plain list of paths', () => {
    const entries = parseM3u('a.mp3\nb.mp3\n');
    expect(entries.map((e) => e.path)).toEqual(['a.mp3', 'b.mp3']);
  });

  it('reads durations and titles from EXTINF', () => {
    const entries = parseM3u('#EXTM3U\n#EXTINF:210,Aphex Twin - Xtal\nmusic/xtal.mp3\n');
    expect(entries).toEqual([
      { path: 'music/xtal.mp3', durationSec: 210, title: 'Aphex Twin - Xtal' },
    ]);
  });

  it('applies an EXTINF only to the path that follows it', () => {
    const entries = parseM3u('#EXTINF:100,First\na.mp3\nb.mp3\n');
    expect(entries[0]?.title).toBe('First');
    expect(entries[1]?.title).toBeNull();
    expect(entries[1]?.durationSec).toBeNull();
  });

  it('treats -1 as an unknown length', () => {
    expect(parseM3u('#EXTINF:-1,Live stream\na.mp3\n')[0]?.durationSec).toBeNull();
  });

  it('survives CRLF, which is what a playlist written on Windows carries', () => {
    // A stray \r on the end of a path stops it matching anything in the library.
    const entries = parseM3u('#EXTM3U\r\n#EXTINF:90,A\r\nmusic/a.mp3\r\n');
    expect(entries[0]?.path).toBe('music/a.mp3');
    expect(entries[0]?.title).toBe('A');
  });

  it('skips blank lines and comments it does not understand', () => {
    const entries = parseM3u('#EXTM3U\n\n# just a note\n#EXTVLCOPT:whatever\na.mp3\n\n');
    expect(entries.map((e) => e.path)).toEqual(['a.mp3']);
  });

  it('is empty for an empty file rather than throwing', () => {
    expect(parseM3u('')).toEqual([]);
    expect(parseM3u('#EXTM3U\n')).toEqual([]);
  });
});

describe('buildM3u', () => {
  it('writes the extended format', () => {
    const text = buildM3u([{ path: 'music/a.mp3', durationSec: 210, title: 'Artist - A' }]);
    expect(text).toBe('#EXTM3U\n#EXTINF:210,Artist - A\nmusic/a.mp3\n');
  });

  it('writes -1 when the length is unknown', () => {
    const text = buildM3u([{ path: 'a.mp3', durationSec: null, title: 'A' }]);
    expect(text).toContain('#EXTINF:-1,A');
  });

  it('omits EXTINF when there is nothing to say', () => {
    expect(buildM3u([{ path: 'a.mp3', durationSec: null, title: null }])).toBe('#EXTM3U\na.mp3\n');
  });

  it('round-trips through the parser', () => {
    const original = [
      { path: 'music/a.mp3', durationSec: 210, title: 'Artist - A' },
      { path: 'music/b.mp3', durationSec: 95, title: 'Artist - B' },
    ];
    expect(parseM3u(buildM3u(original))).toEqual(original);
  });
});

describe('normalise', () => {
  it('turns Windows separators into forward slashes', () => {
    expect(normalise('music\\rock\\a.mp3')).toBe('music/rock/a.mp3');
  });

  it('decodes percent escapes', () => {
    expect(normalise('music/a%20track.mp3')).toBe('music/a track.mp3');
  });

  it('leaves a lone percent alone instead of throwing', () => {
    expect(normalise('music/100%.mp3')).toBe('music/100%.mp3');
  });
});

describe('matchEntry', () => {
  const { byRelPath, byFileName } = indexes(['rock/a.mp3', 'jazz/b.mp3']);
  const entry = (path: string) => ({ path, durationSec: null, title: null });

  it('matches an exact relative path', () => {
    expect(matchEntry(entry('rock/a.mp3'), byRelPath, byFileName)?.relPath).toBe('rock/a.mp3');
  });

  it('matches when the playlist carries a longer path', () => {
    // A playlist saved elsewhere writes the path from its own root.
    const found = matchEntry(entry('/home/me/Music/rock/a.mp3'), byRelPath, byFileName);
    expect(found?.relPath).toBe('rock/a.mp3');
  });

  it('falls back to the file name, which is the weakest evidence and usually right', () => {
    expect(matchEntry(entry('somewhere/else/b.mp3'), byRelPath, byFileName)?.relPath).toBe(
      'jazz/b.mp3',
    );
  });

  it('matches through Windows separators and escapes', () => {
    expect(matchEntry(entry('rock\\a.mp3'), byRelPath, byFileName)?.relPath).toBe('rock/a.mp3');
  });

  it('returns null for something the library does not have', () => {
    expect(matchEntry(entry('nothing/here.mp3'), byRelPath, byFileName)).toBeNull();
  });
});
