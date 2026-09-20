/**
 * The Camelot wheel: the notation DJs use for harmonic mixing.
 *
 * A code is a number from 1 to 12 (position on the circle of fifths) and a letter
 * (`A` minor, `B` major). Two tracks sit well together when they share a code,
 * differ by one step with the same letter, or are a relative major and minor pair
 * (same number, different letter).
 *
 * Notes are named with sharps throughout, because `@vibeamp/dsp` normalises them
 * that way and there is then no enharmonic to get wrong.
 */

import type { KeyScale, PitchClassName } from './types.js';

/** A Camelot code such as `8B` or `5A`. */
export type CamelotCode = string;

export interface ParsedCamelot {
  /** Position on the circle of fifths, 1..12. */
  number: number;
  /** `A` for minor, `B` for major. */
  letter: 'A' | 'B';
}

/**
 * Circle-of-fifths position of each major tonic.
 *
 * C major is 8B, and each fifth up adds one: G is 9, D is 10, and so on, wrapping
 * at 12. The minor codes are the relative minors, which share the number.
 */
const MAJOR_NUMBER: Record<PitchClassName, number> = {
  C: 8,
  G: 9,
  D: 10,
  A: 11,
  E: 12,
  B: 1,
  'F#': 2,
  'C#': 3,
  'G#': 4,
  'D#': 5,
  'A#': 6,
  F: 7,
};

/**
 * Relative minor of each major key, so that A minor gets C major's number (8A).
 *
 * The relative minor is a minor third below the major tonic, which is three
 * semitones down, which is nine up.
 */
const MINOR_NUMBER: Record<PitchClassName, number> = {
  A: 8,
  E: 9,
  B: 10,
  'F#': 11,
  'C#': 12,
  'G#': 1,
  'D#': 2,
  'A#': 3,
  F: 4,
  C: 5,
  G: 6,
  D: 7,
};

/** Convert a tonic and mode to a Camelot code. */
export function toCamelot(root: PitchClassName, scale: KeyScale): CamelotCode {
  if (scale === 'major') return `${MAJOR_NUMBER[root]}B`;
  return `${MINOR_NUMBER[root]}A`;
}

/** Parse a Camelot code, or `null` if it is not one. */
export function parseCamelot(code: string): ParsedCamelot | null {
  const match = /^([1-9]|1[0-2])([AB])$/.exec(code.trim().toUpperCase());
  if (match === null) return null;
  const [, digits, letter] = match;
  if (digits === undefined || letter === undefined) return null;
  return { number: Number(digits), letter: letter as 'A' | 'B' };
}

/**
 * Harmonic distance between two Camelot codes, 0 (identical) to 1 (a clash).
 *
 * The steps between are the moves a DJ actually makes: the relative key, then one
 * position around the wheel, then two. Anything else is a clash and is scored as
 * such, which is what keeps the queue from walking into a key change that draws
 * attention to itself.
 *
 * An unparseable code returns 1 rather than throwing: a track whose key could not
 * be estimated should lose on key and still be allowed to win on everything else.
 */
export function camelotDistance(a: string, b: string): number {
  const first = parseCamelot(a);
  const second = parseCamelot(b);
  if (first === null || second === null) return 1;

  if (first.number === second.number && first.letter === second.letter) return 0;
  // Relative major and minor: the most forgiving move on the wheel.
  if (first.number === second.number) return 0.15;

  const apart = Math.abs(first.number - second.number);
  const steps = Math.min(apart, 12 - apart);
  if (first.letter === second.letter) {
    if (steps === 1) return 0.25;
    if (steps === 2) return 0.55;
  }
  return 1;
}

/** Every code that mixes well with `code`, nearest first, excluding `code` itself. */
export function compatibleCodes(code: string): CamelotCode[] {
  const parsed = parseCamelot(code);
  if (parsed === null) return [];
  const { number, letter } = parsed;
  const other = letter === 'A' ? 'B' : 'A';
  const step = (offset: number): number => ((number - 1 + offset + 12) % 12) + 1;
  return [`${number}${other}`, `${step(1)}${letter}`, `${step(-1)}${letter}`];
}
