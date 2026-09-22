/**
 * Whether the health checks can tell a defect from a style.
 *
 * Each threshold in `core/health.ts` is a number with a comment claiming what was
 * measured either side of it. This is where those claims are kept true: the same
 * signals, through the same pipeline, asserted against the same constants. A
 * change that moves a measurement fails here rather than quietly turning a fade-out
 * into a truncated file.
 *
 * The hard cases are the ones built to look like defects and not be: a track that
 * stops dead on a beat, a master that is loud without being clipped, a stereo mix
 * narrow enough to be suspicious.
 */

import { describe, expect, it } from 'vitest';
import { sideRatio } from '@vibeamp/dsp';
import { extractFeatures } from '../extract.js';

const RATE = 16_000;
const SECONDS = 45;

/** A chord over a kick. Crude, and enough for every measure here. */
function music(): Float32Array {
  const total = RATE * SECONDS;
  const out = new Float32Array(total);
  let state = 12_345;
  const random = (): number => (state = (state * 1664525 + 1013904223) >>> 0) / 4294967296;

  for (const midi of [57, 60, 64, 69]) {
    const hz = 440 * 2 ** ((midi - 69) / 12);
    const phase = random() * 2 * Math.PI;
    for (let i = 0; i < total; i += 1) {
      let value = 0;
      for (let harmonic = 1; harmonic <= 6; harmonic += 1) {
        value += Math.sin(phase * harmonic + (2 * Math.PI * harmonic * hz * i) / RATE) / harmonic;
      }
      out[i] = (out[i] ?? 0) + 0.1 * value;
    }
  }

  const beat = (60 / 120) * RATE;
  for (let start = 0; start < total; start += beat) {
    const from = Math.floor(start);
    for (let i = 0; i < 0.18 * RATE && from + i < total; i += 1) {
      const envelope = Math.exp(-i / (0.045 * RATE));
      out[from + i] =
        (out[from + i] ?? 0) + 0.8 * envelope * Math.sin((2 * Math.PI * 62 * i) / RATE);
    }
  }

  let peak = 0;
  for (const value of out) peak = Math.max(peak, Math.abs(value));
  for (let i = 0; i < total; i += 1) out[i] = ((out[i] ?? 0) / peak) * 0.89;
  return out;
}

const BASE = music();

/** Faded to nothing over the last three seconds, as most records end. */
function faded(): Float32Array {
  const out = Float32Array.from(BASE);
  const length = Math.round(3 * RATE);
  for (let i = 0; i < length; i += 1) {
    const at = out.length - length + i;
    out[at] = (out[at] ?? 0) * (1 - i / length);
  }
  return out;
}

/** Ending on a released chord, which decays rather than fades. */
function released(): Float32Array {
  const out = Float32Array.from(BASE);
  const length = Math.round(1.2 * RATE);
  for (let i = 0; i < length; i += 1) {
    const at = out.length - length + i;
    out[at] = (out[at] ?? 0) * Math.exp(-i / (0.25 * RATE));
  }
  return out;
}

/** Driven into the ceiling and hard limited, as a loudness-war master is. */
function driven(gain: number): Float32Array {
  const out = new Float32Array(BASE.length);
  for (let i = 0; i < BASE.length; i += 1) {
    out[i] = Math.max(-1, Math.min(1, (BASE[i] ?? 0) * gain));
  }
  return out;
}

/** A file of the right length with nothing in it: a rip that failed silently. */
function silence(): Float32Array {
  const out = new Float32Array(RATE * SECONDS);
  let state = 99;
  for (let i = 0; i < out.length; i += 1) {
    state = (state * 1664525 + 1013904223) >>> 0;
    out[i] = (state / 4294967296 - 0.5) * 0.0004;
  }
  return out;
}

describe('how a track ends', () => {
  it('reads a fade-out as an ending, not a cut', () => {
    expect(extractFeatures(faded(), RATE).tailRatio).toBeCloseTo(0.039, 2);
  });

  it('reads a released note as an ending too', () => {
    expect(extractFeatures(released(), RATE).tailRatio).toBeCloseTo(0.012, 2);
  });

  it('reads a track cut mid-bar as ending at full level', () => {
    expect(extractFeatures(BASE, RATE).tailRatio).toBeCloseTo(0.78, 1);
  });

  it('keeps a gap wide enough for a threshold to live in', () => {
    // The thresholds in core/health.ts are only worth anything because of this
    // distance. Asserting it directly means a pipeline change that closes it fails
    // here, where the reason is written down.
    const endings = [extractFeatures(faded(), RATE), extractFeatures(released(), RATE)];
    const cut = extractFeatures(BASE, RATE).tailRatio;
    for (const ending of endings) expect(cut).toBeGreaterThan(ending.tailRatio * 10);
  });
});

describe('clipping', () => {
  it('finds nothing in a loud master that was not clipped', () => {
    // Nearly full scale and untouched by the limiter: loud is not a defect.
    expect(extractFeatures(driven(1.11), RATE).clippedRatio).toBe(0);
  });

  it('finds the flat tops in one driven into the ceiling', () => {
    expect(extractFeatures(driven(2), RATE).clippedRatio).toBeCloseTo(0.0099, 3);
  });

  it('finds more in one driven further', () => {
    expect(extractFeatures(driven(4), RATE).clippedRatio).toBeGreaterThan(
      extractFeatures(driven(2), RATE).clippedRatio * 5,
    );
  });
});

describe('silence', () => {
  it('sits far below anything music reaches', () => {
    const quiet = extractFeatures(silence(), RATE).loudnessDb;
    const loud = extractFeatures(BASE, RATE).loudnessDb;
    expect(quiet).toBeLessThan(-70);
    expect(loud).toBeGreaterThan(-20);
  });
});

describe('two channels', () => {
  /** The same signal in both channels: mono in a stereo container. */
  it('is zero for identical channels', () => {
    expect(sideRatio([BASE, Float32Array.from(BASE)])).toBe(0);
  });

  it('is well clear of zero even for an absurdly narrow mix', () => {
    const narrow = new Float32Array(BASE.length);
    for (let i = 0; i < BASE.length; i += 1) {
      narrow[i] = (BASE[i] ?? 0) * 0.97 + (BASE[(i + 40) % BASE.length] ?? 0) * 0.03;
    }
    expect(sideRatio([BASE, narrow])!).toBeCloseTo(0.0207, 3);
  });

  it('is an order of magnitude higher for an ordinary mix', () => {
    const other = Float32Array.from(BASE);
    let state = 7;
    for (let i = 0; i < other.length; i += 1) {
      state = (state * 1664525 + 1013904223) >>> 0;
      other[i] = (other[i] ?? 0) * 0.8 + (state / 4294967296 - 0.5) * 0.25;
    }
    expect(sideRatio([BASE, other])!).toBeGreaterThan(0.2);
  });

  it('has no answer for a file that is already one channel', () => {
    expect(sideRatio([BASE])).toBeNull();
    expect(sideRatio([])).toBeNull();
  });
});
