/**
 * Whether the duplicate finder can actually tell a duplicate from a near miss.
 *
 * This is the test the feature stands or falls on, so it runs the whole real
 * pipeline — synthesised audio through `extractFeatures`, through `normaliseFeatures`,
 * into `findDuplicates` — rather than asserting on hand-written descriptors. An
 * earlier design passed a unit test on invented numbers and failed here: averaged
 * descriptors put a remaster further from its original than a different piece was,
 * and no threshold existed. The measurement is the point.
 *
 * The pairs are built to be hard on purpose. "Different music" here means the same
 * synthesiser, the same drum, the same tempo and the same key — two tracks off one
 * album — because that is where a duplicate finder cries wolf. Real libraries are
 * easier than this.
 */

import { describe, expect, it } from 'vitest';
import {
  DUPLICATE_THRESHOLD,
  createLibraryStatistics,
  findDuplicates,
  normaliseFeatures,
  pairDistance,
} from '@vibeamp/core';
import type { RawFeatures, Track } from '@vibeamp/core';
import { extractFeatures } from '../extract.js';

const RATE = 16_000;
const SECONDS = 40;

interface Render {
  bpm: number;
  /** MIDI note of the key's tonic. 57 is A3. */
  root: number;
  minor: boolean;
  /** Changes the oscillator phases: a second performance of the same music. */
  seed: number;
  /** Chord roots in semitones above the tonic, one per bar of four beats. */
  progression?: number[];
  /** A lossy re-encode's noise floor. */
  noise?: number;
  gain?: number;
  /** Shifts the whole signal, as an encoder's padding does. */
  offsetMs?: number;
  /** Ratio of a remaster's compression. */
  compress?: number;
  /** Level of the hi-hat, which moves every spectral descriptor there is. */
  bright?: number;
}

/**
 * Synthesise a track: a chord progression over a four-to-the-floor kick.
 *
 * Crude, and deliberately so — every pair below shares this same timbre, so the
 * only thing that can separate them is the music.
 */
function render(options: Render): Float32Array {
  const { bpm, root, minor, seed } = options;
  const total = RATE * SECONDS;
  const out = new Float32Array(total);
  let state = seed;
  const random = (): number => (state = (state * 1664525 + 1013904223) >>> 0) / 4294967296;

  const size = 2048;
  const table = new Float32Array(size);
  for (let i = 0; i < size; i += 1) {
    let value = 0;
    for (let harmonic = 1; harmonic <= 6; harmonic += 1) {
      value += Math.sin((2 * Math.PI * harmonic * i) / size) / harmonic;
    }
    table[i] = value;
  }

  const beat = (60 / bpm) * RATE;
  const bar = beat * 4;
  const progression = options.progression ?? [0];
  for (let index = 0; index * bar < total; index += 1) {
    const degree = progression[index % progression.length] ?? 0;
    // A minor key's third, sixth and seventh degrees carry major chords.
    const major = minor ? [3, 8, 10].includes(degree) : [0, 5, 7].includes(degree);
    const chordRoot = root + degree;
    const chord = [chordRoot, chordRoot + (major ? 4 : 3), chordRoot + 7, chordRoot + 12];
    const from = Math.floor(index * bar);
    const to = Math.min(total, Math.floor((index + 1) * bar));
    for (const midi of chord) {
      const hz = 440 * 2 ** ((midi - 69) / 12);
      const step = (hz * size) / RATE;
      let phase = random() * size;
      for (let i = from; i < to; i += 1) {
        out[i] = (out[i] ?? 0) + 0.12 * (table[Math.floor(phase) % size] ?? 0);
        phase += step;
      }
    }
  }

  for (let start = 0; start < total; start += beat) {
    const from = Math.floor(start);
    for (let i = 0; i < 0.18 * RATE && from + i < total; i += 1) {
      const envelope = Math.exp(-i / (0.045 * RATE));
      const kick = 0.8 * envelope * Math.sin((2 * Math.PI * 62 * i) / RATE);
      const hat =
        (options.bright ?? 0.1) * envelope * Math.exp(-i / (0.004 * RATE)) * (random() * 2 - 1);
      out[from + i] = (out[from + i] ?? 0) + kick + hat;
    }
  }

  let peak = 0;
  for (const value of out) peak = Math.max(peak, Math.abs(value));
  for (let i = 0; i < total; i += 1) out[i] = ((out[i] ?? 0) / peak) * 0.89;

  const shift = Math.round(((options.offsetMs ?? 0) / 1000) * RATE);
  const result = new Float32Array(total);
  for (let i = 0; i < total; i += 1) {
    let value = out[(i + shift + total) % total] ?? 0;
    if (options.noise !== undefined) value += (random() * 2 - 1) * options.noise;
    if (options.compress !== undefined) {
      value = Math.tanh(value * options.compress) / Math.tanh(options.compress);
    }
    if (options.gain !== undefined) value *= options.gain;
    result[i] = Math.max(-1, Math.min(1, value));
  }
  return result;
}

function asTrack(id: string, raw: RawFeatures, lastModified: number, durationSec = SECONDS): Track {
  return {
    id,
    rootId: 'root',
    relPath: `${id}.wav`,
    fileName: `${id}.wav`,
    size: 1,
    lastModified,
    durationSec,
    meta: {
      title: id,
      artist: null,
      albumArtist: null,
      album: null,
      year: null,
      trackNo: null,
      genre: null,
      hasCoverArt: false,
    },
    analysis: normaliseFeatures(raw, createLibraryStatistics()),
    analysisVersion: 2,
    analyzedAt: 1,
    status: 'done',
    attempts: 0,
  };
}

/** A minor, i - VI - III - VII: the progression a great deal of pop runs on. */
const BASE: Render = { bpm: 120, root: 57, minor: true, seed: 7, progression: [0, 8, 3, 10] };

let clock = 0;
function track(options: Render, id: string, durationSec = SECONDS): Track {
  clock += 1;
  return asTrack(id, extractFeatures(render(options), RATE), clock, durationSec);
}

describe('telling a duplicate from a near miss', () => {
  const original = track(BASE, 'original');

  /** The same recording, in a different file. Every one of these must be caught. */
  const sameRecording: Array<[string, Track]> = [
    [
      're-encoded, quieter, shifted 26ms',
      track({ ...BASE, noise: 0.004, gain: 0.97, offsetMs: 26 }, 'reencode'),
    ],
    ['remastered: compressed 3.2 to 1', track({ ...BASE, compress: 3.2 }, 'remaster')],
    ['brighter percussion', track({ ...BASE, bright: 0.35 }, 'brighter')],
  ];

  /**
   * Different music that agrees on everything a coarse filter looks at: same
   * tempo, same length, and in two of the three cases the same key. None of these
   * may be reported.
   */
  const differentMusic: Array<[string, Track]> = [
    [
      'another progression in the same key',
      track({ ...BASE, progression: [0, 5, 7, 0], seed: 31 }, 'other-progression'),
    ],
    [
      'the same progression, another order',
      track({ ...BASE, progression: [8, 10, 3, 3], seed: 44 }, 'reordered'),
    ],
    ['major instead of minor', track({ ...BASE, minor: false }, 'major')],
    ['transposed up a minor third', track({ ...BASE, root: 60 }, 'transposed')],
    ['the same music at 128 BPM', track({ ...BASE, bpm: 128 }, 'faster')],
  ];

  it.each(sameRecording)('matches %s', (_name, copy) => {
    const distance = pairDistance(original, copy);
    expect(distance).not.toBeNull();
    expect(distance!).toBeLessThan(DUPLICATE_THRESHOLD);
  });

  it.each(differentMusic)('does not match %s', (_name, other) => {
    const distance = pairDistance(original, other);
    expect(distance).not.toBeNull();
    expect(distance!).toBeGreaterThan(DUPLICATE_THRESHOLD);
  });

  it('keeps a gap between the two, rather than only a threshold between them', () => {
    // A threshold that works because it was fitted to these numbers is worth
    // nothing. What makes it trustworthy is the distance between the worst match
    // and the best near miss, and that is what this asserts.
    const worstMatch = Math.max(...sameRecording.map(([, copy]) => pairDistance(original, copy)!));
    const closestMiss = Math.min(
      ...differentMusic.map(([, other]) => pairDistance(original, other)!),
    );
    expect(closestMiss).toBeGreaterThan(worstMatch * 2);
  });

  it('groups the copies and leaves the rest alone', () => {
    const groups = findDuplicates([
      original,
      ...sameRecording.map(([, copy]) => copy),
      ...differentMusic.map(([, other]) => other),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]!.tracks.map((one) => one.id).sort()).toEqual(
      ['brighter', 'original', 'reencode', 'remaster'].sort(),
    );
    // The file that has been there longest leads, because it is usually the one
    // the person meant to keep.
    expect(groups[0]!.tracks[0]!.id).toBe('original');
  });

  it('calls a remaster a different master and a re-encode the same one', () => {
    const remaster = findDuplicates([original, track({ ...BASE, compress: 3.2 }, 'remaster-2')]);
    expect(remaster[0]?.verdict).toBe('different-master');

    const reencode = findDuplicates([
      original,
      track({ ...BASE, noise: 0.004, gain: 0.97, offsetMs: 26 }, 'reencode-2'),
    ]);
    expect(reencode[0]?.verdict).toBe('same-master');
  });

  it('never compares tracks of different lengths', () => {
    // The duration bucket is what keeps this from being every pair against every
    // other, so a copy that claims a different length must not be reported however
    // well its fingerprint matches.
    const mislabelled = track({ ...BASE, noise: 0.004 }, 'mislabelled', SECONDS + 9);
    expect(findDuplicates([original, mislabelled])).toEqual([]);
  });

  it('says nothing about a track it could not fingerprint', () => {
    const unanalysed: Track = { ...original, id: 'unknown', analysis: null, status: 'pending' };
    expect(pairDistance(original, unanalysed)).toBeNull();
    expect(findDuplicates([original, unanalysed])).toEqual([]);
  });
});
