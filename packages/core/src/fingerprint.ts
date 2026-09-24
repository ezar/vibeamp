/**
 * A recording's fingerprint.
 *
 * The descriptors elsewhere in this package describe what a track *is like*: how
 * fast, how bright, how loud. None of them describes which track it is. They are
 * averages, and averaging is exactly what destroys identity — two different songs
 * in A minor at 120 BPM average to nearly the same numbers, because that is what
 * being in A minor at 120 BPM means.
 *
 * This was measured rather than assumed. Run through the real pipeline, the
 * averaged descriptors put a remaster of a track at 0.119 from its original and a
 * genuinely different piece at 0.071 — the wrong way round, with no threshold in
 * between. See `packages/analysis/src/__tests__/duplicates.test.ts`, which keeps
 * the measurement honest.
 *
 * What survives re-encoding, a gain change and a remaster, and still differs
 * between two pieces of music, is the *order of events*: the chord that follows
 * this chord, the bar where the bass drops out. So the fingerprint is a chroma
 * sequence — twelve pitch classes sampled repeatedly across the track — and
 * comparing two of them is comparing how they move, not where they sit.
 *
 * It is stored as text, one printable character per byte pair, so that it travels
 * through IndexedDB, JSON export and structured clone without any layer needing to
 * know what it is.
 */

/** Segments the fingerprint samples: the same excerpts the descriptors use. */
export const FINGERPRINT_SEGMENTS = 3;
/** Frames per segment. At a ten second segment, half a second each. */
export const FINGERPRINT_FRAMES = 20;
/** Pitch classes per frame. */
export const FINGERPRINT_BINS = 12;
/** Bytes in a complete fingerprint. */
export const FINGERPRINT_BYTES = FINGERPRINT_SEGMENTS * FINGERPRINT_FRAMES * FINGERPRINT_BINS;

/**
 * Frames a comparison may slide by, in either direction.
 *
 * Two files of the same recording can differ by up to the duration tolerance, and
 * the segments are taken at fractions of the duration, so the same music lands at a
 * slightly different offset in each. Three frames is a second and a half of slack,
 * which covers it without letting a segment match a different part of itself.
 */
const MAX_LAG = 3;

import { bytesToText, textToBytes } from './base64url.js';

/**
 * Pack a chroma sequence into the stored text form.
 *
 * @param frames One vector of {@link FINGERPRINT_BINS} per frame, segments laid end
 *   to end, each already normalised to a peak of 1.
 * @returns Null when the sequence is not the shape a fingerprint has, so that a
 *   half-built one is never stored as if it were complete.
 */
export function encodeFingerprint(frames: readonly (readonly number[])[]): string | null {
  if (frames.length !== FINGERPRINT_SEGMENTS * FINGERPRINT_FRAMES) return null;

  const bytes = new Uint8Array(FINGERPRINT_BYTES);
  let at = 0;
  for (const frame of frames) {
    if (frame.length !== FINGERPRINT_BINS) return null;
    for (const value of frame) {
      // Values arrive in 0..1. Anything outside is a bug upstream, not a reason to
      // refuse the whole fingerprint, so it is clamped.
      const clamped = Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
      bytes[at] = Math.round(clamped * 255);
      at += 1;
    }
  }
  return bytesToText(bytes);
}

/**
 * Read the stored text form back.
 *
 * @returns Null for anything that is not a fingerprint this version wrote — the
 *   wrong length, or a character outside the alphabet.
 */
export function decodeFingerprint(text: string): Uint8Array | null {
  return textToBytes(text, FINGERPRINT_BYTES);
}

/**
 * How far apart two fingerprints are.
 *
 * Each segment is compared on its own and allowed to slide by up to {@link MAX_LAG}
 * frames, because the same music does not land at the same offset in two files of
 * slightly different length. Within a segment each pitch class is centred on its
 * own mean before correlating, which subtracts the static profile — how much C
 * there is in this track overall — and leaves only how each pitch class rises and
 * falls. That static profile is what two pieces in the same key share and what an
 * averaged chroma is made of; the movement is what they do not share.
 *
 * Pitch classes are compared where they are, so a cover in another key scores as
 * far away as unrelated music. That is the right answer here: a transposed version
 * is not a file anyone would delete as a duplicate.
 *
 * @returns 0 for identical movement, 1 for unrelated, up to 2 for opposed. Null
 *   when neither string is a fingerprint, or when every segment of one of them is
 *   too static to correlate — a drone or a silence, where the question has no
 *   answer rather than a confident one.
 */
export function fingerprintDistance(a: string, b: string): number | null {
  const first = decodeFingerprint(a);
  const second = decodeFingerprint(b);
  if (first === null || second === null) return null;

  const stride = FINGERPRINT_FRAMES * FINGERPRINT_BINS;
  let total = 0;
  let counted = 0;

  for (let segment = 0; segment < FINGERPRINT_SEGMENTS; segment += 1) {
    const offset = segment * stride;
    let best: number | null = null;
    for (let lag = -MAX_LAG; lag <= MAX_LAG; lag += 1) {
      const score = correlate(first, second, offset, lag);
      if (score !== null && (best === null || score > best)) best = score;
    }
    if (best === null) continue;
    total += best;
    counted += 1;
  }

  if (counted === 0) return null;
  return 1 - total / counted;
}

/**
 * Correlation of one segment at one lag.
 *
 * @param offset Start of the segment, in bytes, in both fingerprints.
 * @param lag Frames to shift `b` by, positive meaning later.
 * @returns -1..1, or null when either side has no variation left after centring.
 */
function correlate(a: Uint8Array, b: Uint8Array, offset: number, lag: number): number | null {
  const from = Math.max(0, -lag);
  const to = Math.min(FINGERPRINT_FRAMES, FINGERPRINT_FRAMES - lag);
  const frames = to - from;
  if (frames < FINGERPRINT_FRAMES - MAX_LAG) return null;

  const left = new Float64Array(frames * FINGERPRINT_BINS);
  const right = new Float64Array(frames * FINGERPRINT_BINS);
  for (let frame = 0; frame < frames; frame += 1) {
    for (let bin = 0; bin < FINGERPRINT_BINS; bin += 1) {
      left[frame * FINGERPRINT_BINS + bin] =
        a[offset + (from + frame) * FINGERPRINT_BINS + bin] ?? 0;
      right[frame * FINGERPRINT_BINS + bin] =
        b[offset + (from + frame + lag) * FINGERPRINT_BINS + bin] ?? 0;
    }
  }

  centreByBin(left, frames);
  centreByBin(right, frames);

  let dot = 0;
  let normLeft = 0;
  let normRight = 0;
  for (let i = 0; i < left.length; i += 1) {
    const one = left[i] ?? 0;
    const other = right[i] ?? 0;
    dot += one * other;
    normLeft += one * one;
    normRight += other * other;
  }
  if (normLeft === 0 || normRight === 0) return null;
  return Math.min(1, Math.max(-1, dot / Math.sqrt(normLeft * normRight)));
}

/** Subtract each pitch class's own mean across the frames, in place. */
function centreByBin(values: Float64Array, frames: number): void {
  for (let bin = 0; bin < FINGERPRINT_BINS; bin += 1) {
    let sum = 0;
    for (let frame = 0; frame < frames; frame += 1)
      sum += values[frame * FINGERPRINT_BINS + bin] ?? 0;
    const average = sum / frames;
    for (let frame = 0; frame < frames; frame += 1) {
      const at = frame * FINGERPRINT_BINS + bin;
      values[at] = (values[at] ?? 0) - average;
    }
  }
}
