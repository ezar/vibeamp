import { describe, expect, it } from 'vitest';
import { chromaVector } from '../chroma.js';
import { estimateKey, PITCH_CLASS_NAMES } from '../key.js';
import { chord, midiToHz, progression, whiteNoise } from './signals.js';

const SAMPLE_RATE = 16000;

/**
 * A chroma vector shaped like tonal music in a given key: the triad carries most
 * of the weight, the rest of the scale some, the chromatic notes almost none.
 *
 * Index 0 is the tonic; the caller rotates it to the key it wants.
 */
const MAJOR_SHAPE = [1, 0.05, 0.4, 0.05, 0.8, 0.45, 0.05, 0.9, 0.05, 0.4, 0.05, 0.35];
const MINOR_SHAPE = [1, 0.05, 0.4, 0.8, 0.05, 0.45, 0.05, 0.9, 0.4, 0.05, 0.4, 0.05];

function chromaInKey(shape: readonly number[], tonic: number): Float64Array {
  const chroma = new Float64Array(12);
  for (let i = 0; i < 12; i++) chroma[(i + tonic) % 12] = shape[i] ?? 0;
  return chroma;
}

/** I - IV - V - I, the shortest progression that establishes a major key. */
function majorCadence(tonicMidi: number): number[][] {
  return [
    [tonicMidi, tonicMidi + 4, tonicMidi + 7],
    [tonicMidi + 5, tonicMidi + 9, tonicMidi + 12],
    [tonicMidi + 7, tonicMidi + 11, tonicMidi + 14],
    [tonicMidi, tonicMidi + 4, tonicMidi + 7],
  ];
}

/** i - iv - V - i, with the raised seventh that makes a minor key sound minor. */
function minorCadence(tonicMidi: number): number[][] {
  return [
    [tonicMidi, tonicMidi + 3, tonicMidi + 7],
    [tonicMidi + 5, tonicMidi + 8, tonicMidi + 12],
    [tonicMidi + 7, tonicMidi + 11, tonicMidi + 14],
    [tonicMidi, tonicMidi + 3, tonicMidi + 7],
  ];
}

describe('chromaVector', () => {
  it('peaks on the notes of a chord', () => {
    // C4, E4, G4 => pitch classes 0, 4, 7.
    const signal = chord([60, 64, 67].map(midiToHz), 2, SAMPLE_RATE);
    const chroma = chromaVector(signal, SAMPLE_RATE);

    const ranked = [...chroma.entries()].sort((a, b) => b[1] - a[1]).map(([index]) => index);
    expect(ranked.slice(0, 3).sort((a, b) => a - b)).toEqual([0, 4, 7]);
  });

  it('is all zeros for silence', () => {
    const chroma = chromaVector(new Float32Array(SAMPLE_RATE * 2), SAMPLE_RATE);
    expect([...chroma]).toEqual(new Array(12).fill(0));
  });

  it('is normalised so the strongest class is one', () => {
    const chroma = chromaVector(chord([midiToHz(60)], 2, SAMPLE_RATE), SAMPLE_RATE);
    expect(Math.max(...chroma)).toBeCloseTo(1, 6);
  });

  it('is empty rather than throwing for a signal shorter than one frame', () => {
    expect([...chromaVector(new Float32Array(64), SAMPLE_RATE)]).toEqual(new Array(12).fill(0));
  });
});

describe('estimateKey', () => {
  it('rejects a chroma vector of the wrong length', () => {
    expect(() => estimateKey(new Float64Array(7))).toThrow(/12 long/);
  });

  it('finds the tonic and mode of every one of the 24 keys', () => {
    for (let tonic = 0; tonic < 12; tonic++) {
      const major = estimateKey(chromaInKey(MAJOR_SHAPE, tonic));
      expect([major.root, major.scale]).toEqual([PITCH_CLASS_NAMES[tonic], 'major']);

      const minor = estimateKey(chromaInKey(MINOR_SHAPE, tonic));
      expect([minor.root, minor.scale]).toEqual([PITCH_CLASS_NAMES[tonic], 'minor']);
    }
  });

  it('names notes with sharps, never flats', () => {
    for (let tonic = 0; tonic < 12; tonic++) {
      expect(estimateKey(chromaInKey(MAJOR_SHAPE, tonic)).root).not.toContain('b');
    }
  });

  it('is weak for noise, which has no key', () => {
    const key = estimateKey(chromaVector(whiteNoise(4, SAMPLE_RATE), SAMPLE_RATE));
    expect(key.strength).toBeLessThan(0.6);
  });

  it('gives silence a zero strength instead of a null', () => {
    const key = estimateKey(new Float64Array(12));
    expect(key.strength).toBe(0);
    expect(key.root).toBe('C');
  });

  it('reports a small margin when the relative minor is nearly as good a fit', () => {
    // The margin exists to say "this could be the relative key". It should be small
    // for a bare triad, which belongs to both, and larger for a full cadence.
    const triad = estimateKey(
      chromaVector(chord([60, 64, 67].map(midiToHz), 2, SAMPLE_RATE), SAMPLE_RATE),
    );
    const cadence = estimateKey(
      chromaVector(progression(majorCadence(60), 0.5, SAMPLE_RATE), SAMPLE_RATE),
    );
    expect(cadence.margin).toBeGreaterThan(triad.margin);
  });
});

describe('estimateKey over synthesised audio', () => {
  it('hears C major in a C major cadence', () => {
    const key = estimateKey(
      chromaVector(progression(majorCadence(60), 0.5, SAMPLE_RATE), SAMPLE_RATE),
    );
    expect(key.root).toBe('C');
    expect(key.scale).toBe('major');
    expect(key.strength).toBeGreaterThan(0.6);
  });

  it('hears A minor in an A minor cadence', () => {
    const key = estimateKey(
      chromaVector(progression(minorCadence(57), 0.5, SAMPLE_RATE), SAMPLE_RATE),
    );
    expect(key.root).toBe('A');
    expect(key.scale).toBe('minor');
  });

  it('transposes with the music', () => {
    for (const [tonicMidi, expected] of [
      [62, 'D'],
      [65, 'F'],
      [67, 'G'],
    ] as const) {
      const key = estimateKey(
        chromaVector(progression(majorCadence(tonicMidi), 0.5, SAMPLE_RATE), SAMPLE_RATE),
      );
      expect(key.root).toBe(expected);
      expect(key.scale).toBe('major');
    }
  });

  it('cannot tell an unweighted scale from its relative key, and says so', () => {
    // Documented, not worked around: the seven pitch classes of C major are exactly
    // those of A natural minor. Nothing can separate them, the margin is what admits
    // it, and the Camelot wheel treats the two as compatible anyway.
    const scale = [0, 2, 4, 5, 7, 9, 11].map((step) => 60 + step);
    const key = estimateKey(chromaVector(chord(scale.map(midiToHz), 2, SAMPLE_RATE), SAMPLE_RATE));
    expect(key.margin).toBeLessThan(0.25);
  });
});
