/**
 * Reading somebody else's list.
 *
 * A want list arrives in whatever the last program to touch it wrote: a CSV out of
 * a streaming export tool, a `.m3u` off an old drive, or a few dozen lines pasted
 * out of a message. All three are the same information — an artist and a title,
 * repeated — and none of them is worth asking the person to convert by hand.
 *
 * So the format is sniffed rather than chosen. Nothing here is rejected for being
 * the wrong shape; a file that yields no entries yields none, and the window says
 * so, which is more use than a parser that refuses a file it could have read.
 */

import { parseM3u } from './m3u.js';
import { splitArtistTitle } from '@vibeamp/core';
import type { WantEntry } from '@vibeamp/core';

/** Header cells that name the title column, folded to lower case. */
const TITLE_COLUMNS = ['track name', 'title', 'name', 'song', 'track', 'track title'];
/** The same, for the artist column. `artist name(s)` is what an export tool writes. */
const ARTIST_COLUMNS = ['artist name(s)', 'artist name', 'artist', 'artists', 'album artist'];

/**
 * Read a list in whichever of the three shapes it arrived in.
 *
 * @returns Entries in the order they were written, blank and duplicate-free lines
 *   kept as they are: a list with the same track twice is the person's list, and
 *   silently collapsing it would make the counts disagree with what they pasted.
 */
export function parseWantList(text: string): WantEntry[] {
  const trimmed = text.trim();
  if (trimmed === '') return [];

  if (/^#EXTM3U/im.test(trimmed) || /^#EXTINF:/im.test(trimmed)) return fromM3u(trimmed);

  const csv = fromCsv(trimmed);
  if (csv !== null) return csv;

  return fromLines(trimmed);
}

/** `#EXTINF:210,Artist - Title`, which is the only part of a playlist that names anything. */
function fromM3u(text: string): WantEntry[] {
  const entries: WantEntry[] = [];
  for (const entry of parseM3u(text)) {
    // A playlist entry with no `#EXTINF` carries only a path. The file name is
    // the closest thing to a name it has, and it is often `Artist - Title.mp3`.
    const line = entry.title ?? fileStem(entry.path);
    if (line.trim() === '') continue;
    entries.push({ ...splitArtistTitle(line), line });
  }
  return entries;
}

/**
 * A spreadsheet, if it looks like one.
 *
 * @returns Null when the first row is not a header naming a title column, which is
 *   how a list of plain "Artist - Title" lines containing a comma avoids being
 *   read as a two-column table.
 */
function fromCsv(text: string): WantEntry[] | null {
  const rows = parseCsv(text);
  const header = rows[0];
  if (header === undefined || header.length < 2) return null;

  const folded = header.map((cell) => cell.trim().toLowerCase());
  const titleAt = folded.findIndex((cell) => TITLE_COLUMNS.includes(cell));
  if (titleAt === -1) return null;
  const artistAt = folded.findIndex((cell) => ARTIST_COLUMNS.includes(cell));

  const entries: WantEntry[] = [];
  for (const row of rows.slice(1)) {
    const title = (row[titleAt] ?? '').trim();
    if (title === '') continue;
    // An export tool writes several artists into one cell, separated by commas
    // that are inside the quotes. The first is the one the library tagged.
    const artists = artistAt === -1 ? '' : (row[artistAt] ?? '').trim();
    const artist = artists === '' ? null : (artists.split(',')[0] ?? artists).trim();
    entries.push({ artist, title, line: artist === null ? title : `${artist} — ${title}` });
  }
  return entries;
}

/** One entry per line, `Artist - Title` where there is a dash and a title where there is not. */
function fromLines(text: string): WantEntry[] {
  const entries: WantEntry[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    entries.push({ ...splitArtistTitle(line), line });
  }
  return entries;
}

/**
 * Split a CSV into rows of cells.
 *
 * Hand-written because the rule that matters is the one a `split(',')` gets wrong:
 * a quoted cell may hold commas, newlines and doubled quotes, and every export of
 * a track called "Everything, Everything" does.
 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const character = text[i];
    if (quoted) {
      if (character !== '"') {
        cell += character;
        continue;
      }
      // A doubled quote inside a quoted cell is one literal quote.
      if (text[i + 1] === '"') {
        cell += '"';
        i += 1;
        continue;
      }
      quoted = false;
      continue;
    }

    if (character === '"') {
      quoted = true;
      continue;
    }
    if (character === ',') {
      row.push(cell);
      cell = '';
      continue;
    }
    if (character === '\n' || character === '\r') {
      // Only end the row on the first character of the break, so CRLF does not
      // produce an empty row between every pair of real ones.
      if (character === '\r' && text[i + 1] === '\n') i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      continue;
    }
    cell += character;
  }

  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/** `…/Artist - Title.mp3` to `Artist - Title`. */
function fileStem(path: string): string {
  const name = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);
  return decodeSafely(name).replace(/\.[^.]+$/, '');
}

function decodeSafely(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}
