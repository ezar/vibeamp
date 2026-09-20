/**
 * M3U playlists.
 *
 * The format the shell's own "Load list" and "Save list" entries expect. Without
 * handlers for them Webamp falls back to a browser `alert` reading "Not supported
 * in Webamp", which names the wrong product at the user.
 *
 * Deliberately the plain format: `#EXTM3U`, an optional `#EXTINF` line per entry,
 * then a path. Everything else a player might write is ignored rather than
 * rejected, because a playlist half-read is more use than one refused.
 */

/** One entry of a parsed playlist. */
export interface M3uEntry {
  /** The path as written, which may be relative, absolute or a URL. */
  path: string;
  /** Duration in seconds from `#EXTINF`, or null when there was none. */
  durationSec: number | null;
  /** Display name from `#EXTINF`, or null. */
  title: string | null;
}

/**
 * Read a playlist.
 *
 * Blank lines and comments are skipped. An `#EXTINF` applies to the next path that
 * follows it, which is what every writer of this format assumes.
 */
export function parseM3u(text: string): M3uEntry[] {
  const entries: M3uEntry[] = [];
  let pending: { durationSec: number | null; title: string | null } | null = null;

  // Files written on Windows carry CRLF, and a stray \r on the end of a path stops
  // it matching anything in the library.
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '') continue;

    if (line.startsWith('#')) {
      pending = line.toUpperCase().startsWith('#EXTINF:') ? parseExtInf(line) : pending;
      continue;
    }

    entries.push({
      path: line,
      durationSec: pending?.durationSec ?? null,
      title: pending?.title ?? null,
    });
    pending = null;
  }

  return entries;
}

/** `#EXTINF:210,Artist - Title` */
function parseExtInf(line: string): { durationSec: number | null; title: string | null } {
  const body = line.slice(line.indexOf(':') + 1);
  const comma = body.indexOf(',');
  if (comma === -1) return { durationSec: toDuration(body), title: null };

  const title = body.slice(comma + 1).trim();
  return { durationSec: toDuration(body.slice(0, comma)), title: title === '' ? null : title };
}

/** `#EXTINF` writes -1 for an unknown length. */
function toDuration(value: string): number | null {
  const seconds = Number(value.trim());
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  return seconds;
}

export interface M3uOutput {
  path: string;
  durationSec: number | null;
  title: string | null;
}

/** Write a playlist in the extended format. */
export function buildM3u(entries: readonly M3uOutput[]): string {
  const lines = ['#EXTM3U'];
  for (const entry of entries) {
    if (entry.title !== null || entry.durationSec !== null) {
      // -1 is the format's own way of saying the length is not known.
      const seconds = entry.durationSec === null ? -1 : Math.round(entry.durationSec);
      lines.push(`#EXTINF:${seconds},${entry.title ?? entry.path}`);
    }
    lines.push(entry.path);
  }
  // A trailing newline, because a file that does not end in one upsets line-based
  // tools for no benefit.
  return `${lines.join('\n')}\n`;
}

/**
 * Match a playlist entry against the library.
 *
 * Paths in a playlist are written relative to wherever it was saved, and a library
 * moved between machines matches on none of them. So the comparison walks from the
 * most specific to the least: the exact relative path, then the tail of it, then
 * the file name alone. A name is the weakest evidence but it is usually right, and
 * a playlist that resolves most of its entries beats one that resolves none.
 */
export function matchEntry<T extends { relPath: string; fileName: string }>(
  entry: M3uEntry,
  byRelPath: ReadonlyMap<string, T>,
  byFileName: ReadonlyMap<string, T>,
): T | null {
  const path = normalise(entry.path);
  const exact = byRelPath.get(path);
  if (exact !== undefined) return exact;

  for (const [relPath, track] of byRelPath) {
    if (path.endsWith(`/${relPath}`) || relPath.endsWith(`/${path}`)) return track;
  }

  const name = path.slice(path.lastIndexOf('/') + 1);
  return byFileName.get(name) ?? null;
}

/** Backslashes to forward slashes, and percent-escapes decoded where they are valid. */
export function normalise(path: string): string {
  const slashed = path.replace(/\\/g, '/');
  try {
    return decodeURIComponent(slashed);
  } catch {
    // A lone `%` is not an escape; the path is still usable as written.
    return slashed;
  }
}
