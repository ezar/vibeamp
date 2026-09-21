/**
 * The fingerprint's own properties, without the pipeline.
 *
 * What it is worth on real signals is measured in
 * `packages/analysis/src/__tests__/duplicates.test.ts`. This covers the parts that
 * have to hold whatever the audio was: that the text form survives a round trip,
 * that anything else is refused rather than half-read, and that the comparison
 * reads movement rather than key.
 */

import { describe, expect, it } from 'vitest';
import {
  FINGERPRINT_BINS,
  FINGERPRINT_BYTES,
  FINGERPRINT_FRAMES,
  FINGERPRINT_SEGMENTS,
  decodeFingerprint,
  encodeFingerprint,
  fingerprintDistance,
} from '../fingerprint.js';

const TOTAL_FRAMES = FINGERPRINT_SEGMENTS * FINGERPRINT_FRAMES;

/** Frames whose values come from `shape`, so a test can state the movement it means. */
function frames(shape: (frame: number, bin: number) => number): number[][] {
  return Array.from({ length: TOTAL_FRAMES }, (_, frame) =>
    Array.from({ length: FINGERPRINT_BINS }, (_, bin) =>
      Math.min(1, Math.max(0, shape(frame, bin))),
    ),
  );
}

/** A chord progression: one pitch class lit per bar, rotating through four. */
function progression(order: readonly number[], offset = 0): number[][] {
  return frames((frame, bin) => {
    const chord = order[Math.floor((frame + offset) / 4) % order.length] ?? 0;
    return bin === chord ? 1 : 0.05;
  });
}

describe('encoding', () => {
  it('survives a round trip', () => {
    const text = encodeFingerprint(frames((frame, bin) => ((frame * 7 + bin * 13) % 256) / 255));
    expect(text).not.toBeNull();

    const bytes = decodeFingerprint(text!);
    expect(bytes).not.toBeNull();
    expect(bytes!.length).toBe(FINGERPRINT_BYTES);
    for (let i = 0; i < FINGERPRINT_BYTES; i += 1) {
      const frame = Math.floor(i / FINGERPRINT_BINS);
      const bin = i % FINGERPRINT_BINS;
      expect(bytes![i]).toBe((frame * 7 + bin * 13) % 256);
    }
  });

  it('is text that survives a JSON export unchanged', () => {
    const text = encodeFingerprint(progression([0, 4, 7, 9]))!;
    expect(JSON.parse(JSON.stringify({ text })).text).toBe(text);
    expect(text).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('refuses a sequence that is not the shape a fingerprint has', () => {
    expect(encodeFingerprint([])).toBeNull();
    expect(encodeFingerprint(frames(() => 0).slice(0, TOTAL_FRAMES - 1))).toBeNull();

    const short = frames(() => 0);
    short[3] = [1, 0, 0];
    expect(encodeFingerprint(short)).toBeNull();
  });

  it('refuses text it did not write', () => {
    const text = encodeFingerprint(progression([0, 4, 7, 9]))!;
    expect(decodeFingerprint('')).toBeNull();
    expect(decodeFingerprint(text.slice(1))).toBeNull();
    expect(decodeFingerprint(`${text.slice(1)}*`)).toBeNull();
  });
});

/** Mean of a sequence's frames: what the design before this one compared. */
function average(sequence: readonly (readonly number[])[]): number[] {
  const total = new Array<number>(FINGERPRINT_BINS).fill(0);
  for (const frame of sequence) {
    for (let bin = 0; bin < FINGERPRINT_BINS; bin += 1) total[bin]! += frame[bin] ?? 0;
  }
  return total.map((value) => value / sequence.length);
}

function cosineDistance(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += (a[i] ?? 0) * (b[i] ?? 0);
    normA += (a[i] ?? 0) ** 2;
    normB += (b[i] ?? 0) ** 2;
  }
  return 1 - dot / Math.sqrt(normA * normB);
}

describe('comparing', () => {
  it('is zero for a fingerprint against itself', () => {
    const text = encodeFingerprint(progression([0, 4, 7, 9]))!;
    expect(fingerprintDistance(text, text)).toBeCloseTo(0, 6);
  });

  it('separates two pieces that their averaged chroma cannot', () => {
    // The whole reason this exists. Both progressions use the same four pitch
    // classes for the same share of the time, so their average chroma agrees to
    // within one per cent — and that average is what the design before this one
    // compared, which is why it could not tell two tracks off one album apart.
    const one = progression([0, 4, 7, 9]);
    const other = progression([9, 0, 7, 4]);
    expect(cosineDistance(average(one), average(other))).toBeLessThan(0.02);

    // In what order they arrive, the two disagree completely.
    expect(
      fingerprintDistance(encodeFingerprint(one)!, encodeFingerprint(other)!)!,
    ).toBeGreaterThan(0.5);
  });

  it('puts a transposed copy far away, because it is not the same recording', () => {
    // The same progression a fifth up. The movement is identical and every pitch
    // class differs, and this compares pitch classes: a cover in another key is
    // not a file you would delete, so it must not be reported as one.
    const home = encodeFingerprint(progression([0, 4, 7, 9]))!;
    const transposed = encodeFingerprint(progression([7, 11, 2, 4]))!;
    expect(fingerprintDistance(home, transposed)!).toBeGreaterThan(0.5);
  });

  it('forgives a small shift in time', () => {
    // Two files of the same recording sample the same music at slightly different
    // offsets, because the segments are taken at fractions of a duration that the
    // encoders did not agree on.
    const onTime = encodeFingerprint(progression([0, 4, 7, 9]))!;
    const late = encodeFingerprint(progression([0, 4, 7, 9], 2))!;
    expect(fingerprintDistance(onTime, late)!).toBeLessThan(0.2);
  });

  it('does not forgive a shift beyond what it allows', () => {
    const onTime = encodeFingerprint(progression([0, 4, 7, 9]))!;
    const halfABarLate = encodeFingerprint(progression([0, 4, 7, 9], 8))!;
    expect(fingerprintDistance(onTime, halfABarLate)!).toBeGreaterThan(0.5);
  });

  it('has no answer for a fingerprint with no movement in it', () => {
    // A drone, or a silence. There is nothing to correlate, and a confident zero
    // would match it against every other drone in the library.
    const drone = encodeFingerprint(frames((_frame, bin) => (bin === 0 ? 1 : 0.1)))!;
    const other = encodeFingerprint(progression([0, 4, 7, 9]))!;
    expect(fingerprintDistance(drone, other)).toBeNull();
    expect(fingerprintDistance(drone, drone)).toBeNull();
  });

  it('has no answer for text that is not a fingerprint', () => {
    const text = encodeFingerprint(progression([0, 4, 7, 9]))!;
    expect(fingerprintDistance(text, 'not a fingerprint')).toBeNull();
  });
});
