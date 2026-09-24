/**
 * Names: comparing them, and inventing them when there are none.
 *
 * Two jobs that look unrelated and are the same job. A want list arrives as text —
 * "Artist – Title", a hundred times over — and has to be matched against a library
 * whose own names came from tags written by a dozen different rippers. Meanwhile a
 * good share of any real collection has no tags at all, and those files can never
 * match anything until they are given a name.
 *
 * Neither half invents information. {@link normaliseName} only removes what two
 * spellings of the same thing disagree about; {@link inferFromPath} only reads what
 * somebody already wrote, in the one place an untagged rip always writes it, which
 * is the folder it sits in.
 */

/**
 * Parenthetical and trailing suffixes that name an *edition* rather than a
 * recording, and so must not keep two spellings of one track apart.
 *
 * `live` is deliberately absent. A live version is a different performance, and
 * folding it into the studio take would report a track as owned that is not.
 */
const EDITION_NOISE =
  /\b(remaster(?:ed)?(?:\s+\d{4})?|\d{4}\s+remaster(?:ed)?|radio\s+edit|single\s+version|album\s+version|original\s+mix|digital\s+remaster(?:ed)?|deluxe(?:\s+edition)?|bonus\s+track|explicit|clean|mono|stereo|remaster)\b/g;

/** `feat.`, `ft.` and `featuring`, with everything after them to the end or bracket. */
const FEATURING = /\s*[([]?\s*\b(?:feat|ft|featuring|with)\b\.?\s+[^)\]]*[)\]]?/g;

/**
 * Fold a name to the form two spellings of it agree on.
 *
 * Accents dropped, case dropped, `&` spelled out, edition noise and featured
 * artists removed, punctuation reduced to spaces. What is left is what the two
 * people who typed it were both trying to say.
 *
 * @returns The folded form, which is empty when nothing survived. An empty result
 *   must never be treated as a match: two tracks named `(2011 Remaster)` and
 *   nothing else are not the same track.
 */
export function normaliseName(text: string): string {
  return (
    text
      .normalize('NFD')
      // Combining marks: this is what turns "Bjö" into "Bjo" rather than dropping
      // the letter entirely, which is what a plain ASCII filter would do.
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(FEATURING, ' ')
      .replace(EDITION_NOISE, ' ')
      // Apostrophes are *removed* rather than turned into a space, and the three
      // kinds are treated alike. Whether a title is written "Don't", "Don’t" or
      // "Dont" is the single thing two taggers most reliably disagree about, and
      // spacing it would leave "don t" matching neither of the others.
      .replace(/['‘’ʼ`]/g, '')
      // Everything else that is not a letter or a digit becomes a space: dashes,
      // brackets and the rest carry no meaning that survives a re-tag.
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim()
      .replace(/\s+/g, ' ')
  );
}

/**
 * Split an "Artist – Title" line.
 *
 * All three dashes, because a list pasted out of a music app uses whichever one
 * that app happened to print. The *first* separator wins: "Artist - Title - Live"
 * is an artist and a title, not a title and an artist.
 *
 * @returns Artist null when the line carries no separator, which is a title on its
 *   own rather than a reason to reject the line.
 */
export function splitArtistTitle(line: string): { artist: string | null; title: string } {
  const match = /^(.+?)\s+[-–—]\s+(.+)$/.exec(line.trim());
  if (match === null) return { artist: null, title: line.trim() };
  const [, artist, title] = match;
  if (artist === undefined || title === undefined) return { artist: null, title: line.trim() };
  return { artist: artist.trim(), title: title.trim() };
}

/** A name read out of a path, with how much of it the path actually said. */
export interface InferredName {
  artist: string | null;
  album: string | null;
  title: string;
  trackNo: number | null;
}

/** Leading track numbers, in the several shapes rippers write them. */
const LEADING_NUMBER = /^\s*(?:(?:\d{1,2})[-_.\s]+)?(\d{1,3})\s*[-_.)\s]+\s*(?=\S)/;

/**
 * Read a name out of where the file sits.
 *
 * An untagged rip is almost never a loose file: it is `Artist/Album/03 Title.mp3`,
 * or `Artist - Album/03 - Title.flac`, and the person who ripped it typed the
 * artist and the album exactly once, into the folder names. This reads them back.
 *
 * Everything here is a guess and is labelled as one by the caller. What it is not
 * is a fabrication: every field returned was typed by somebody, and a field the
 * path does not carry comes back null rather than invented.
 *
 * @param relPath Path relative to the library root, forward slashes.
 */
export function inferFromPath(relPath: string): InferredName {
  const parts = relPath.split('/').filter((part) => part !== '');
  const file = parts.at(-1) ?? relPath;
  const stem = file.replace(/\.[^.]+$/, '');

  const numbered = LEADING_NUMBER.exec(stem);
  const trackNo = numbered === null ? null : Number(numbered[1]);
  const withoutNumber = numbered === null ? stem : stem.slice(numbered[0].length);

  // A file name that carries its own artist wins over the folders: whoever wrote
  // it there was being more specific than the directory they dropped it in.
  const inFile = splitArtistTitle(withoutNumber.replace(/_/g, ' '));
  const folders = parts.slice(0, -1);
  const parent = folders.at(-1) ?? null;
  const grandparent = folders.at(-2) ?? null;

  // `Artist - Album` as a single folder, which is the other common layout.
  const split = parent === null ? null : splitArtistTitle(parent);
  const folderArtist = split?.artist ?? grandparent;
  const folderAlbum = split?.artist === null ? parent : (split?.title ?? parent);

  return {
    artist: inFile.artist ?? folderArtist ?? null,
    album: folderAlbum,
    title: inFile.title === '' ? stem : inFile.title,
    trackNo: trackNo !== null && Number.isFinite(trackNo) && trackNo > 0 ? trackNo : null,
  };
}
