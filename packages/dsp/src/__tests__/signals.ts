/**
 * Synthetic signals for the DSP tests.
 *
 * Fixtures are generated rather than stored, for the same reason kinetrace stores
 * the recipe instead of the landmarks: a test that says "a click track at 120 BPM"
 * is reviewable, and a megabyte of samples is not.
 */

/** Deterministic PRNG, so a failing test fails the same way twice. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A sine wave. */
export function sine(
  frequencyHz: number,
  seconds: number,
  sampleRate: number,
  amplitude = 1,
): Float32Array {
  const out = new Float32Array(Math.round(seconds * sampleRate));
  for (let i = 0; i < out.length; i++) {
    out[i] = amplitude * Math.sin((2 * Math.PI * frequencyHz * i) / sampleRate);
  }
  return out;
}

/** The sum of several sines, scaled so the result stays inside full scale. */
export function chord(
  frequenciesHz: readonly number[],
  seconds: number,
  sampleRate: number,
): Float32Array {
  const out = new Float32Array(Math.round(seconds * sampleRate));
  for (const frequency of frequenciesHz) {
    for (let i = 0; i < out.length; i++) {
      out[i] += Math.sin((2 * Math.PI * frequency * i) / sampleRate);
    }
  }
  const scale = 1 / Math.max(1, frequenciesHz.length);
  for (let i = 0; i < out.length; i++) out[i] *= scale;
  return out;
}

/** Uniform white noise in -1..1. */
export function whiteNoise(seconds: number, sampleRate: number, seed = 1): Float32Array {
  const random = mulberry32(seed);
  const out = new Float32Array(Math.round(seconds * sampleRate));
  for (let i = 0; i < out.length; i++) out[i] = random() * 2 - 1;
  return out;
}

/**
 * A click track: short decaying noise bursts at a fixed tempo.
 *
 * Broadband bursts rather than tones, because that is what a tempo estimator
 * reading spectral flux is meant to lock onto.
 */
export function clickTrack(
  bpm: number,
  seconds: number,
  sampleRate: number,
  seed = 7,
): Float32Array {
  const random = mulberry32(seed);
  const out = new Float32Array(Math.round(seconds * sampleRate));
  const period = (60 / bpm) * sampleRate;
  const burstLength = Math.round(0.03 * sampleRate);

  for (let beat = 0; ; beat++) {
    const start = Math.round(beat * period);
    if (start >= out.length) break;
    for (let i = 0; i < burstLength && start + i < out.length; i++) {
      const decay = Math.exp((-5 * i) / burstLength);
      out[start + i] += (random() * 2 - 1) * decay;
    }
  }
  return out;
}

/** Equal-tempered frequency of a MIDI note number. */
export function midiToHz(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

/**
 * A sequence of chords, each held for the same length.
 *
 * Needed because an unweighted scale does not have a key: the seven pitch classes
 * of C major are exactly those of A natural minor. What makes a key audible is
 * which notes are emphasised, and a progression is the simplest fixture that
 * emphasises anything.
 */
export function progression(
  chords: readonly (readonly number[])[],
  secondsEach: number,
  sampleRate: number,
): Float32Array {
  const parts = chords.map((midiNotes) =>
    chord(
      midiNotes.map((note) => midiToHz(note)),
      secondsEach,
      sampleRate,
    ),
  );
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Float32Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
