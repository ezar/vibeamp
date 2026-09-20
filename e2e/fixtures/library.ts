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
