/**
 * A library to test against.
 *
 * The auto-DJ needs thirty analysed tracks before it will do anything, so the only
 * way to test it end to end is to give it thirty. They are generated rather than
 * committed: ten megabytes of audio in the repository to prove a queue renders is
 * a bad trade, and generated tracks have a known tempo and key, which is what makes
 * the assertions worth making.
 *
 * Each file is a real WAV a browser decodes: a chord held under a kick on every
 * beat. Nothing musical, but every descriptor has something true to measure.
 */

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const RATE = 16_000;
const SECONDS = 10;
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

/** Tempos spread widely enough that the planner has real choices to make. */
const TEMPOS = [96, 104, 110, 118, 124, 128, 132, 140] as const;

export interface GeneratedTrack {
  fileName: string;
  bpm: number;
  /** Pitch class name plus `m` for minor, as the file is named. */
  key: string;
}

/**
 * Write a library of `count` tracks to a fresh temporary directory.
 *
 * @returns The directory to hand to the folder picker, and what is in it.
 */
export function writeLibrary(count: number): { dir: string; tracks: GeneratedTrack[] } {
  const dir = mkdtempSync(join(tmpdir(), 'vibeamp-e2e-'));
  const tracks: GeneratedTrack[] = [];

  for (let index = 0; index < count; index += 1) {
    const bpm = TEMPOS[index % TEMPOS.length] ?? 120;
    const root = 48 + ((index * 5) % 12);
    const minor = index % 3 !== 0;
    const key = `${NAMES[root % 12] ?? 'C'}${minor ? 'm' : ''}`;
    const fileName = `${String(index + 1).padStart(2, '0')} - ${bpm} BPM in ${key}.wav`;

    writeFileSync(join(dir, fileName), wav(render(bpm, root, minor)));
    tracks.push({ fileName, bpm, key });
  }

  return { dir, tracks };
}

/** A chord under a kick, as mono float samples in -1..1. */
function render(bpm: number, root: number, minor: boolean): Float32Array {
  const total = RATE * SECONDS;
  const out = new Float32Array(total);
  const chord = [root, root + (minor ? 3 : 4), root + 7, root + 12];

  // Six harmonics per voice: a bare sine has nothing above its own pitch, and the
  // brightness descriptor would read every track the same.
  const size = 2048;
  const table = new Float32Array(size);
  for (let i = 0; i < size; i += 1) {
    let value = 0;
    for (let harmonic = 1; harmonic <= 6; harmonic += 1) {
      value += Math.sin((2 * Math.PI * harmonic * i) / size) / harmonic;
    }
    table[i] = value;
  }

  for (const midi of chord) {
    const hz = 440 * 2 ** ((midi - 69) / 12);
    const step = (hz * size) / RATE;
    let phase = 0;
    for (let i = 0; i < total; i += 1) {
      out[i] += 0.12 * (table[Math.floor(phase) % size] ?? 0);
      phase += step;
    }
  }

  // Kick on every beat, and nothing between them: an onset every half beat makes
  // the tempo genuinely ambiguous, and then the estimator is right to read double.
  const beat = (60 / bpm) * RATE;
  for (let start = 0; start < total; start += beat) {
    const from = Math.floor(start);
    for (let i = 0; i < 0.18 * RATE && from + i < total; i += 1) {
      const envelope = Math.exp(-i / (0.045 * RATE));
      out[from + i] += 0.8 * envelope * Math.sin((2 * Math.PI * 62 * i) / RATE);
      out[from + i] += 0.1 * envelope * Math.exp(-i / (0.004 * RATE)) * (Math.random() * 2 - 1);
    }
  }

  let peak = 0;
  for (const value of out) peak = Math.max(peak, Math.abs(value));
  if (peak > 0) for (let i = 0; i < total; i += 1) out[i] = ((out[i] ?? 0) / peak) * 0.89;
  return out;
}

/** Wrap samples as a 16 bit mono WAV. */
function wav(samples: Float32Array): Buffer {
  const body = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i += 1) {
    body.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i] ?? 0)) * 32_767), i * 2);
  }

  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + body.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(body.length, 40);
  return Buffer.concat([header, body]);
}

/**
 * A small library that holds one recording twice, for the duplicate finder.
 *
 * Separate from {@link writeLibrary} rather than an option on it, because the two
 * want opposite things. That one wants short files and a spread of keys, so that
 * thirty of them analyse inside a test's patience. This one wants tracks long
 * enough to fingerprint — about fifteen seconds is the floor — and a chord
 * progression, because a fingerprint reads how the harmony moves and a track that
 * holds one chord for forty seconds has no movement to read.
 *
 * The copy is what a second rip of the same CD would be: the same performance, a
 * little quieter, with a lossy encoder's noise floor and its padding at the front.
 * Nothing about the file name or the tags says the two are related.
 */
export function writeDuplicateLibrary(): {
  dir: string;
  tracks: GeneratedTrack[];
  /** The two file names that hold the same recording. */
  duplicates: [string, string];
} {
  const dir = mkdtempSync(join(tmpdir(), 'vibeamp-dupes-'));
  const seconds = 20;
  const tracks: GeneratedTrack[] = [];

  const write = (fileName: string, samples: Float32Array, bpm: number, key: string): void => {
    writeFileSync(join(dir, fileName), wav(samples));
    tracks.push({ fileName, bpm, key });
  };

  const originals: Array<{ bpm: number; root: number; minor: boolean }> = [
    { bpm: 120, root: 57, minor: true },
    { bpm: 100, root: 60, minor: false },
    { bpm: 132, root: 62, minor: true },
  ];

  originals.forEach((spec, index) => {
    const key = `${NAMES[spec.root % 12] ?? 'C'}${spec.minor ? 'm' : ''}`;
    write(
      `${String(index + 1).padStart(2, '0')} - ${spec.bpm} BPM in ${key}.wav`,
      progressionTrack(spec.bpm, spec.root, spec.minor, seconds, index),
      spec.bpm,
      key,
    );
  });

  const first = originals[0]!;
  const copy = degrade(progressionTrack(first.bpm, first.root, first.minor, seconds, 0));
  write('anonymous-rip.wav', copy, first.bpm, 'Am');

  return {
    dir,
    tracks,
    duplicates: [tracks[0]!.fileName, 'anonymous-rip.wav'],
  };
}

/** A chord progression over a kick: four bars of i - VI - III - VII, or I - IV - V - IV. */
function progressionTrack(
  bpm: number,
  root: number,
  minor: boolean,
  seconds: number,
  seed: number,
): Float32Array {
  const total = RATE * seconds;
  const out = new Float32Array(total);
  let state = seed * 7919 + 13;
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
  const degrees = minor ? [0, 8, 3, 10] : [0, 5, 7, 5];

  for (let index = 0; index * bar < total; index += 1) {
    const degree = degrees[index % degrees.length] ?? 0;
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
      const hat = 0.1 * envelope * Math.exp(-i / (0.004 * RATE)) * (random() * 2 - 1);
      out[from + i] = (out[from + i] ?? 0) + kick + hat;
    }
  }

  let peak = 0;
  for (const value of out) peak = Math.max(peak, Math.abs(value));
  if (peak > 0) for (let i = 0; i < total; i += 1) out[i] = ((out[i] ?? 0) / peak) * 0.89;
  return out;
}

/** The same signal as a second rip of it: quieter, noisier, and 40ms late. */
function degrade(samples: Float32Array): Float32Array {
  const shift = Math.round(0.04 * RATE);
  const out = new Float32Array(samples.length);
  let state = 4242;
  const random = (): number => (state = (state * 1664525 + 1013904223) >>> 0) / 4294967296;

  for (let i = 0; i < samples.length; i += 1) {
    const value = (samples[(i + shift) % samples.length] ?? 0) * 0.94 + (random() * 2 - 1) * 0.004;
    out[i] = Math.max(-1, Math.min(1, value));
  }
  return out;
}
