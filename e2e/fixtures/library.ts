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

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
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
function wav(samples: Float32Array, tags?: { artist: string; title: string }): Buffer {
  const body = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i += 1) {
    body.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i] ?? 0)) * 32_767), i * 2);
  }

  // A `LIST`/`INFO` chunk, which is how a WAV carries tags. Written before the
  // audio, which is legal and is where every writer of this format puts it.
  const info =
    tags === undefined
      ? Buffer.alloc(0)
      : (() => {
          const entries = Buffer.concat([
            Buffer.from('INFO', 'latin1'),
            infoChunk('INAM', tags.title),
            infoChunk('IART', tags.artist),
          ]);
          const head = Buffer.alloc(8);
          head.write('LIST', 0, 'latin1');
          head.writeUInt32LE(entries.length, 4);
          return Buffer.concat([head, entries]);
        })();

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
  // The declared RIFF size counts everything after it, tags included.
  header.writeUInt32LE(36 + info.length + body.length, 4);
  return Buffer.concat([header.subarray(0, 36), info, header.subarray(36), body]);
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

/**
 * A progression belonging to this seed alone.
 *
 * Without it, two tracks that differ only in tempo play the identical four chords
 * in the identical key, which makes them the same piece of music at two speeds —
 * and the duplicate finder says so, correctly, filling a fixture with pairs nobody
 * planted. The tonic stays first so the key is still readable; the other three
 * bars are the seed written in base seven over the scale degrees.
 */
function progressionFor(seed: number, minor: boolean): number[] {
  const scale = minor ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11];
  const digits = [Math.floor(seed / 49) % 7, Math.floor(seed / 7) % 7, seed % 7];
  return [0, ...digits.map((digit) => scale[digit] ?? 0)];
}

/** A chord progression over a kick, the progression chosen by `seed`. */
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
  const degrees = progressionFor(seed, minor);

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

/**
 * A library with real defects in it, for the condition report.
 *
 * Every file here is broken in a way that no tag records and that only listening to
 * the samples can find: a mono recording in a stereo container, a download that
 * stopped early, a master driven into the ceiling, a rip that produced silence.
 * Two of them are built to look broken and not be — a track that stops dead on a
 * beat is a genre, and a loud master is not a clipped one.
 */
export function writeUnhealthyLibrary(): {
  dir: string;
  tracks: GeneratedTrack[];
  /** File names by the defect each one carries. */
  defects: Record<'fakeStereo' | 'truncated' | 'clipped' | 'silent' | 'padded', string>;
} {
  const dir = mkdtempSync(join(tmpdir(), 'vibeamp-health-'));
  const seconds = 40;
  const tracks: GeneratedTrack[] = [];

  const add = (fileName: string, data: Buffer, bpm: number): void => {
    writeFileSync(join(dir, fileName), data);
    tracks.push({ fileName, bpm, key: 'Am' });
  };

  const body = (bpm: number, seed: number): Float32Array =>
    progressionTrack(bpm, 57, true, seconds, seed);

  // Healthy: ends by fading, and genuinely two channels.
  for (let i = 0; i < 2; i += 1) {
    const samples = faded(body(120 + i * 6, i + 1));
    add(`healthy-${i + 1}.wav`, stereoWav(samples, widen(samples, i + 9)), 120 + i * 6);
  }

  // Healthy, and built to look broken: stops dead on the beat, as club music does.
  const stopsDead = body(128, 3);
  add('stops-on-the-beat.wav', stereoWav(stopsDead, widen(stopsDead, 11)), 128);

  // Healthy, and built to look broken: loud, and not clipped.
  const loud = gain(faded(body(124, 4)), 1.11);
  add('loud-master.wav', stereoWav(loud, widen(loud, 12)), 124);

  const fake = faded(body(118, 5));
  add('fake-stereo.wav', stereoWav(fake, fake), 118);

  // Truncated: ends at full level because it has no fade.
  //
  // Deliberately its own piece rather than a cut copy of a healthy one. A track is
  // keyed by the hash of its first mebibyte and its size, so a copy that differs
  // only in its last three seconds is the same track — the two files collide into
  // one row and the library comes up one short, which is the identity scheme
  // working and the fixture being wrong.
  const truncated = body(136, 7);
  add('truncated-download.wav', stereoWav(truncated, widen(truncated, 14)), 136);

  // Clipped in both channels, as a real loudness-war master is. Driving only one
  // of them would not show: the analysis works on the mono downmix, where a clean
  // channel averages the other one's flat tops away.
  const loudEnough = faded(body(132, 6));
  add(
    'clipped-master.wav',
    stereoWav(gain(loudEnough, 2.2), gain(widen(loudEnough, 13), 2.4)),
    132,
  );

  // Padded: a rip that kept five seconds of lead-in and four of run-out. Nothing
  // is wrong with the recording; the file is simply longer than it is.
  //
  // Both channels are padded after they are widened, not widened after they are
  // padded. `widen` adds noise across whatever it is given, and noise fifteen
  // decibels under the music is not silence — the detector is right to refuse it,
  // and a fixture built the other way round measures nothing.
  const music = faded(body(126, 8));
  const padded = new Float32Array(RATE * (seconds + 9));
  const paddedRight = new Float32Array(padded.length);
  padded.set(music, RATE * 5);
  paddedRight.set(widen(music, 15), RATE * 5);
  add('kept-the-lead-in.wav', stereoWav(padded, paddedRight), 126);

  const silent = new Float32Array(RATE * seconds);
  let state = 4242;
  for (let i = 0; i < silent.length; i += 1) {
    state = (state * 1664525 + 1013904223) >>> 0;
    silent[i] = (state / 4294967296 - 0.5) * 0.0004;
  }
  add('failed-rip.wav', stereoWav(silent, silent), 120);

  return {
    dir,
    tracks,
    defects: {
      fakeStereo: 'fake-stereo.wav',
      truncated: 'truncated-download.wav',
      clipped: 'clipped-master.wav',
      padded: 'kept-the-lead-in.wav',
      silent: 'failed-rip.wav',
    },
  };
}

/** Faded to nothing over the last three seconds, as most records end. */
function faded(source: Float32Array): Float32Array {
  const out = Float32Array.from(source);
  const length = Math.round(3 * RATE);
  for (let i = 0; i < length; i += 1) {
    const at = out.length - length + i;
    out[at] = (out[at] ?? 0) * (1 - i / length);
  }
  return out;
}

function gain(source: Float32Array, amount: number): Float32Array {
  const out = new Float32Array(source.length);
  for (let i = 0; i < source.length; i += 1) {
    out[i] = Math.max(-1, Math.min(1, (source[i] ?? 0) * amount));
  }
  return out;
}

/** A second channel that genuinely differs, so the pair reads as real stereo. */
function widen(source: Float32Array, seed: number): Float32Array {
  const out = Float32Array.from(source);
  let state = seed * 2654435761;
  for (let i = 0; i < out.length; i += 1) {
    state = (state * 1664525 + 1013904223) >>> 0;
    out[i] = (out[i] ?? 0) * 0.82 + (state / 4294967296 - 0.5) * 0.2;
  }
  return out;
}

/** Wrap two channels as a 16 bit stereo WAV, interleaved. */
function stereoWav(left: Float32Array, right: Float32Array): Buffer {
  const frames = Math.min(left.length, right.length);
  const body = Buffer.alloc(frames * 4);
  const clamp = (value: number): number => Math.round(Math.max(-1, Math.min(1, value)) * 32_767);
  for (let i = 0; i < frames; i += 1) {
    body.writeInt16LE(clamp(left[i] ?? 0), i * 4);
    body.writeInt16LE(clamp(right[i] ?? 0), i * 4 + 2);
  }

  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + body.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(2, 22);
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 4, 28);
  header.writeUInt16LE(4, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(body.length, 40);
  return Buffer.concat([header, body]);
}

/**
 * A library built to have holes in it, for the gap finder.
 *
 * Two groups of keys that cannot reach each other by any move the Camelot wheel
 * allows — A minor and B minor are two steps apart — with the code that would join
 * them, F# minor, deliberately absent. And a stretch of tempo with music on both
 * sides and nothing in it.
 *
 * Every track gets its own progression and a fade, so neither the duplicate finder
 * nor the condition report has anything to say about any of them: the window is
 * only showing what this fixture is about.
 */
export function writeSplitLibrary(): {
  dir: string;
  tracks: GeneratedTrack[];
  /** The code that would join the two groups. */
  bridge: string;
} {
  const dir = mkdtempSync(join(tmpdir(), 'vibeamp-split-'));
  const seconds = 40;
  const tracks: GeneratedTrack[] = [];

  // A minor is 8A and B minor is 10A; 9A, which touches both, is left out.
  const specs: Array<{ bpm: number; root: number; key: string }> = [
    { bpm: 96, root: 57, key: 'Am' },
    { bpm: 98, root: 57, key: 'Am' },
    { bpm: 100, root: 59, key: 'Bm' },
    { bpm: 136, root: 57, key: 'Am' },
    { bpm: 138, root: 59, key: 'Bm' },
    { bpm: 140, root: 59, key: 'Bm' },
  ];

  specs.forEach((spec, index) => {
    const fileName = `${String(index + 1).padStart(2, '0')} - ${spec.bpm} BPM in ${spec.key}.wav`;
    writeFileSync(
      join(dir, fileName),
      wav(faded(progressionTrack(spec.bpm, spec.root, true, seconds, index + 20))),
    );
    tracks.push({ fileName, bpm: spec.bpm, key: spec.key });
  });

  return { dir, tracks, bridge: '9A' };
}

/**
 * Files that differ only in how much spectrum they have, for the second decode.
 *
 * Written at 44.1 kHz, because the question is about the octave the ordinary
 * analysis cannot reach: at the 16 kHz it decodes to, every one of these looks
 * identical.
 *
 * A WAV band-limited to 16 kHz is exactly the shape of a transcode — a file
 * carrying a lossless file's worth of bytes and a 128 kbps file's worth of
 * bandwidth — which is the disagreement the check is built to find.
 */
export function writeBandwidthLibrary(): {
  dir: string;
  tracks: GeneratedTrack[];
  /** The file whose bytes and bandwidth disagree. */
  transcoded: string;
  /** The file that kept its whole top end. */
  full: string;
} {
  const dir = mkdtempSync(join(tmpdir(), 'vibeamp-band-'));
  const rate = 44_100;
  const seconds = 12;
  const tracks: GeneratedTrack[] = [];

  const write = (fileName: string, cornerHz: number, seed: number): void => {
    // Faded, so the condition report has nothing to say about these and the window
    // is only showing what this fixture is about.
    const samples = bandLimited(cornerHz, rate, seconds, seed);
    const fade = Math.round(2 * rate);
    for (let i = 0; i < fade; i += 1) {
      const at = samples.length - fade + i;
      samples[at] = (samples[at] ?? 0) * (1 - i / fade);
    }
    writeFileSync(join(dir, fileName), wavAt(samples, rate));
    tracks.push({ fileName, bpm: 0, key: 'C' });
  };

  write('full-band.wav', rate / 2 - 200, 1);
  write('good-encode.wav', 19_000, 2);
  write('transcoded.wav', 16_000, 3);

  return { dir, tracks, transcoded: 'transcoded.wav', full: 'full-band.wav' };
}

/**
 * Noise built up to a wall and no further.
 *
 * Synthesised rather than filtered: a filter steep enough to stand in for an
 * encoder's brick wall is harder to write than the signal it would produce, and
 * summing components up to the corner and stopping puts the wall exactly where
 * this says it is.
 */
function bandLimited(cornerHz: number, rate: number, seconds: number, seed: number): Float32Array {
  const out = new Float32Array(rate * seconds);
  let state = seed * 2654435761;
  const random = (): number => (state = (state * 1664525 + 1013904223) >>> 0) / 4294967296;

  // 200 Hz apart: dense enough to read as broadband, sparse enough to synthesise.
  for (let hz = 200; hz <= Math.min(cornerHz, rate / 2 - 200); hz += 200) {
    const phase = random() * 2 * Math.PI;
    const step = (2 * Math.PI * hz) / rate;
    for (let i = 0; i < out.length; i += 1) out[i] = (out[i] ?? 0) + Math.cos(phase + step * i);
  }

  let peak = 0;
  for (const sample of out) peak = Math.max(peak, Math.abs(sample));
  if (peak > 0) for (let i = 0; i < out.length; i += 1) out[i] = ((out[i] ?? 0) / peak) * 0.89;
  return out;
}

/** The mono WAV writer again, at a rate this fixture chooses. */
function wavAt(samples: Float32Array, rate: number): Buffer {
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
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(body.length, 40);
  return Buffer.concat([header, body]);
}

/**
 * A library whose files mostly have no names, for the naming pass and the want list.
 *
 * The case worth testing is the one no tag editor can reach: `unsorted/t7.wav` is a
 * re-encode of the tagged file beside it, and nothing about the two names, sizes or
 * dates says so. Only the fingerprint does. Beside it, `Pixies/Doolittle/03
 * Debaser.wav` is the ordinary untagged rip, where the artist was typed once into a
 * folder name, and `04 - 100 BPM in C.wav` is a loose file whose path says nothing —
 * which must produce no proposal at all.
 */
export function writeUnnamedLibrary(): {
  dir: string;
  tracks: GeneratedTrack[];
  /** The tagged file the untagged copy borrows its name from. */
  donor: { artist: string; title: string };
  /** The untagged copy of it. */
  bySound: string;
  /** The rip whose artist is only in its folder name. */
  byFolder: { fileName: string; artist: string; title: string };
} {
  const dir = mkdtempSync(join(tmpdir(), 'vibeamp-names-'));
  const seconds = 20;
  const tracks: GeneratedTrack[] = [];
  const donor = { artist: 'Slint', title: 'Breadcrumb Trail' };

  mkdirSync(join(dir, 'Pixies', 'Doolittle'), { recursive: true });
  mkdirSync(join(dir, 'unsorted'), { recursive: true });

  // The tagged one. Its tags live in a RIFF INFO chunk, which is where a WAV
  // carries them and which the app's tag reader reads.
  const known = progressionTrack(120, 57, true, seconds, 21);
  writeFileSync(join(dir, 'known-original.wav'), wav(known, donor));
  tracks.push({ fileName: 'known-original.wav', bpm: 120, key: 'Am' });

  // The same recording, re-encoded and with no tags at all.
  writeFileSync(join(dir, 'unsorted', 't7.wav'), wav(degrade(known)));
  tracks.push({ fileName: 't7.wav', bpm: 120, key: 'Am' });

  // Different music, no tags, but the folders say who made it.
  writeFileSync(
    join(dir, 'Pixies', 'Doolittle', '03 Debaser.wav'),
    wav(progressionTrack(132, 62, false, seconds, 22)),
  );
  tracks.push({ fileName: '03 Debaser.wav', bpm: 132, key: 'D' });

  // Nothing to say about this one, and nothing must be said.
  writeFileSync(
    join(dir, '04 - 100 BPM in C.wav'),
    wav(progressionTrack(100, 60, false, seconds, 23)),
  );
  tracks.push({ fileName: '04 - 100 BPM in C.wav', bpm: 100, key: 'C' });

  return {
    dir,
    tracks,
    donor,
    bySound: 't7.wav',
    byFolder: { fileName: '03 Debaser.wav', artist: 'Pixies', title: 'Debaser' },
  };
}

/** One `INFO` sub-chunk: a four character id, a length, and the text with a null. */
function infoChunk(id: string, text: string): Buffer {
  const body = Buffer.from(`${text}\0`, 'latin1');
  // Every RIFF chunk is padded to an even length, and a reader that trusts the
  // declared size will land mid-chunk on the next one without it.
  const padded = body.length % 2 === 0 ? body : Buffer.concat([body, Buffer.alloc(1)]);
  const header = Buffer.alloc(8);
  header.write(id, 0, 'latin1');
  header.writeUInt32LE(body.length, 4);
  return Buffer.concat([header, padded]);
}
