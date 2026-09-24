/**
 * A collection's shape, small enough to send in a message.
 *
 * The vibe link carries a setting; this carries a library. Not the records — there
 * is nothing identifying in it at all — but the two distributions that say what
 * kind of collection it is: how it sits in tempo, and where it sits on the wheel.
 * Fifty-odd characters, no server, no account, and nothing in it that could be
 * turned back into a list of what somebody owns.
 *
 * That last point is a design constraint rather than a happy accident. Two friends
 * comparing collections is a lovely feature and a horrible thing to build on a
 * server, because the only way to do it there is for both of them to upload what
 * they have. Here the comparison happens on the machine that already holds the
 * records, and what crosses between them is a histogram.
 *
 * The counts are stored as shares of each distribution's own peak rather than as
 * counts, so a library of four hundred and a library of forty thousand compare as
 * the shapes they are. The one absolute number is how many tracks were measured,
 * which is kept because "we overlap at 70%" means something different from a
 * hundred records than from ten thousand.
 */

import {
  bytesToText,
  numberToText,
  textLengthFor,
  textToBytes,
  textToNumber,
} from './base64url.js';
import { TEMPO_BUCKET_BPM, TEMPO_MAX_BPM, TEMPO_MIN_BPM } from './shape.js';
import type { LibraryShape } from './shape.js';

/** Tempo buckets in a code. Fixed by the histogram this is a picture of. */
export const SHAPE_TEMPO_BUCKETS = (TEMPO_MAX_BPM - TEMPO_MIN_BPM) / TEMPO_BUCKET_BPM;
/** Camelot positions in a code. All 24, in wheel order. */
export const SHAPE_KEY_SLICES = 24;
/** Bytes of distribution in a code. */
const BODY_BYTES = SHAPE_TEMPO_BUCKETS + SHAPE_KEY_SLICES;

/** The current format. Bumped when the fields below change meaning or number. */
const PREFIX = 'S1';
/** Characters the analysed count takes. Six digits of base 64 is plenty of library. */
const COUNT_CHARS = 3;
/** Characters in a well-formed code. */
export const SHAPE_CODE_LENGTH = PREFIX.length + COUNT_CHARS + textLengthFor(BODY_BYTES);

/**
 * What a code carries, decoded.
 *
 * Both distributions are normalised to sum to one, so they can be compared against
 * a library of any size. They are not counts and must not be shown as any.
 */
export interface SharedShape {
  /** Tracks the other library measured. */
  analysed: number;
  /** Share of that library in each tempo bucket, summing to 1. */
  tempo: number[];
  /** Share of it at each Camelot position, in wheel order, summing to 1. */
  keys: number[];
}

/** Pack a library's shape into the code that goes in a message. */
export function encodeShapeCode(shape: LibraryShape): string {
  const bytes = new Uint8Array(BODY_BYTES);
  writeGroup(
    bytes,
    0,
    shape.tempo.map((bucket) => bucket.count),
  );
  writeGroup(
    bytes,
    SHAPE_TEMPO_BUCKETS,
    shape.keys.map((slice) => slice.count),
  );

  return `${PREFIX}${numberToText(shape.analysed, COUNT_CHARS)}${bytesToText(bytes)}`;
}

/**
 * Read a code back.
 *
 * @returns Null for anything that is not a code this version wrote. Refusing is the
 *   point: a code from another version decoded as this one produces two plausible
 *   histograms and a comparison that means nothing, and nothing downstream would
 *   ever notice.
 */
export function decodeShapeCode(code: string): SharedShape | null {
  const text = code.trim();
  if (text.length !== SHAPE_CODE_LENGTH) return null;
  if (!text.startsWith(PREFIX)) return null;

  const analysed = textToNumber(text.slice(PREFIX.length, PREFIX.length + COUNT_CHARS));
  if (analysed === null) return null;

  const bytes = textToBytes(text.slice(PREFIX.length + COUNT_CHARS), BODY_BYTES);
  if (bytes === null) return null;

  return {
    analysed,
    tempo: readGroup(bytes, 0, SHAPE_TEMPO_BUCKETS),
    keys: readGroup(bytes, SHAPE_TEMPO_BUCKETS, SHAPE_KEY_SLICES),
  };
}

/**
 * One distribution, as bytes relative to its own peak.
 *
 * Relative to its own peak and not to the other group's: a library whose key
 * histogram has a huge spike would otherwise quantise its whole tempo curve into
 * two or three levels, and the tempo comparison would be a comparison of rounding.
 */
function writeGroup(bytes: Uint8Array, offset: number, counts: readonly number[]): void {
  const peak = Math.max(0, ...counts);
  for (let i = 0; i < counts.length; i += 1) {
    bytes[offset + i] = peak === 0 ? 0 : Math.round(((counts[i] ?? 0) / peak) * 255);
  }
}

/** The same, back, normalised so the group sums to one. */
function readGroup(bytes: Uint8Array, offset: number, count: number): number[] {
  const values = Array.from({ length: count }, (_, i) => (bytes[offset + i] ?? 0) / 255);
  const total = values.reduce((sum, value) => sum + value, 0);
  if (total === 0) return values;
  return values.map((value) => value / total);
}

/** A library's own distributions in the same normalised form, for comparing. */
export function ownShape(shape: LibraryShape): SharedShape {
  return {
    analysed: shape.analysed,
    tempo: normalised(shape.tempo.map((bucket) => bucket.count)),
    keys: normalised(shape.keys.map((slice) => slice.count)),
  };
}

function normalised(counts: readonly number[]): number[] {
  const total = counts.reduce((sum, count) => sum + count, 0);
  if (total === 0) return counts.map(() => 0);
  return counts.map((count) => count / total);
}
