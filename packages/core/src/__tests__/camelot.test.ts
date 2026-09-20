import { describe, expect, it } from 'vitest';
import { camelotDistance, compatibleCodes, parseCamelot, toCamelot } from '../camelot.js';
import type { PitchClassName } from '../types.js';

describe('toCamelot', () => {
  // The table every DJ tool agrees on. Worth writing out in full: an error in one
  // row is invisible in the app and quietly wrong in every queue it builds.
  const MAJOR: ReadonlyArray<[PitchClassName, string]> = [
    ['C', '8B'],
    ['G', '9B'],
    ['D', '10B'],
    ['A', '11B'],
    ['E', '12B'],
    ['B', '1B'],
    ['F#', '2B'],
    ['C#', '3B'],
    ['G#', '4B'],
    ['D#', '5B'],
    ['A#', '6B'],
    ['F', '7B'],
  ];

  const MINOR: ReadonlyArray<[PitchClassName, string]> = [
    ['A', '8A'],
    ['E', '9A'],
    ['B', '10A'],
    ['F#', '11A'],
    ['C#', '12A'],
    ['G#', '1A'],
    ['D#', '2A'],
    ['A#', '3A'],
    ['F', '4A'],
    ['C', '5A'],
    ['G', '6A'],
    ['D', '7A'],
  ];

  it.each(MAJOR)('maps %s major to %s', (root, expected) => {
    expect(toCamelot(root, 'major')).toBe(expected);
  });

  it.each(MINOR)('maps %s minor to %s', (root, expected) => {
    expect(toCamelot(root, 'minor')).toBe(expected);
  });

  it('gives every one of the 24 keys a distinct code', () => {
    const codes = new Set<string>();
    for (const [root] of MAJOR) codes.add(toCamelot(root, 'major'));
    for (const [root] of MINOR) codes.add(toCamelot(root, 'minor'));
    expect(codes.size).toBe(24);
  });

  it('pairs each major key with its relative minor on the same number', () => {
    // A minor is the relative minor of C major, so both are 8.
    expect(parseCamelot(toCamelot('C', 'major'))?.number).toBe(
      parseCamelot(toCamelot('A', 'minor'))?.number,
    );
    expect(parseCamelot(toCamelot('G', 'major'))?.number).toBe(
      parseCamelot(toCamelot('E', 'minor'))?.number,
    );
  });
});

describe('parseCamelot', () => {
  it('reads valid codes, including two digit ones', () => {
    expect(parseCamelot('8B')).toEqual({ number: 8, letter: 'B' });
    expect(parseCamelot('12A')).toEqual({ number: 12, letter: 'A' });
    expect(parseCamelot(' 5a ')).toEqual({ number: 5, letter: 'A' });
  });

  it('rejects anything else', () => {
    for (const bad of ['', '0A', '13B', '8C', 'B8', '8', 'eight', '1.5A']) {
      expect(parseCamelot(bad)).toBeNull();
    }
  });
});

describe('camelotDistance', () => {
  it('is zero for the same key', () => {
    expect(camelotDistance('8B', '8B')).toBe(0);
  });

  it('is small for the relative key', () => {
    expect(camelotDistance('8B', '8A')).toBe(0.15);
  });

  it('is small for a neighbour on the wheel, and wraps around 12', () => {
    expect(camelotDistance('8B', '9B')).toBe(0.25);
    expect(camelotDistance('12A', '1A')).toBe(0.25);
    expect(camelotDistance('1B', '12B')).toBe(0.25);
  });

  it('grows with two steps and rejects the rest', () => {
    expect(camelotDistance('8B', '10B')).toBe(0.55);
    expect(camelotDistance('8B', '11B')).toBe(1);
    // A neighbouring number in the other mode is not a mix.
    expect(camelotDistance('8B', '9A')).toBe(1);
  });

  it('is symmetric', () => {
    for (const [a, b] of [
      ['8B', '9B'],
      ['12A', '1A'],
      ['3A', '7B'],
      ['8B', '10B'],
    ] as const) {
      expect(camelotDistance(a, b)).toBe(camelotDistance(b, a));
    }
  });

  it('treats an unknown key as a clash rather than throwing', () => {
    expect(camelotDistance('', '8B')).toBe(1);
    expect(camelotDistance('8B', 'nonsense')).toBe(1);
  });
});

describe('compatibleCodes', () => {
  it('offers the relative key and both neighbours', () => {
    expect(compatibleCodes('8B').sort()).toEqual(['7B', '8A', '9B']);
  });

  it('wraps around the wheel', () => {
    expect(compatibleCodes('1A').sort()).toEqual(['12A', '1B', '2A']);
    expect(compatibleCodes('12B').sort()).toEqual(['11B', '12A', '1B']);
  });

  it('only ever offers keys it also calls close', () => {
    for (const code of compatibleCodes('5A')) {
      expect(camelotDistance('5A', code)).toBeLessThan(0.3);
    }
  });

  it('is empty for an unparseable code', () => {
    expect(compatibleCodes('nope')).toEqual([]);
  });
});
