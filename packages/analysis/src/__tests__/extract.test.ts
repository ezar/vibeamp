import { describe, expect, it } from 'vitest';
import { ExtractionError, extractFeatures } from '../extract.js';
import type { Stage } from '../protocol.js';

const RATE = 16000;

/** Deterministic PRNG, so a failure reproduces. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A whole track: a click track at `bpm` over a chord, long enough for three windows. */
function synthTrack(bpm: number, seconds: number, midiNotes: readonly number[]): Float32Array {
  const random = mulberry32(3);
  const out = new Float32Array(Math.round(seconds * RATE));
  const period = (60 / bpm) * RATE;
  const burst = Math.round(0.03 * RATE);

  for (const midi of midiNotes) {
    const hz = 440 * 2 ** ((midi - 69) / 12);
    for (let i = 0; i < out.length; i++) {
      out[i]! += (0.4 / midiNotes.length) * Math.sin((2 * Math.PI * hz * i) / RATE);
    }
  }
  for (let beat = 0; ; beat++) {
    const start = Math.round(beat * period);
    if (start >= out.length) break;
    for (let i = 0; i < burst && start + i < out.length; i++) {
      out[start + i]! += 0.5 * (random() * 2 - 1) * Math.exp((-5 * i) / burst);
    }
  }
  return out;
}

describe('extractFeatures', () => {
  it('rejects an empty signal', () => {
    expect(() => extractFeatures(new Float32Array(0), RATE)).toThrow(ExtractionError);
    try {
      extractFeatures(new Float32Array(0), RATE);
    } catch (error) {
      expect((error as ExtractionError).code).toBe('bad_input');
    }
  });

  it('rejects an invalid sample rate', () => {
    expect(() => extractFeatures(new Float32Array(1000), 0)).toThrow(/sample rate/);
  });

  it('reports a track that is too short with its own code', () => {
    try {
      extractFeatures(new Float32Array(RATE), RATE);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as ExtractionError).code).toBe('too_short');
    }
  });

  it('measures a whole synthetic track end to end', () => {
    // C major triad under a 128 BPM click: the one test that exercises every
    // descriptor through the same code path the worker uses.
    const features = extractFeatures(synthTrack(128, 90, [60, 64, 67]), RATE);

    expect(Math.abs(features.bpm - 128)).toBeLessThan(128 * 0.02);
    expect(features.bpmConfidence).toBeGreaterThan(0.3);
    expect(features.keyRoot).toBe('C');
    expect(features.keyScale).toBe('major');
    expect(features.windows).toHaveLength(3);
    expect(features.loudnessDb).toBeLessThan(0);
    expect(features.crestFactor).toBeGreaterThan(1);
    expect(features.centroidHzMean).toBeGreaterThan(0);
    expect(features.danceabilityRaw).toBeGreaterThan(0);
    expect(features.danceabilityRaw).toBeLessThanOrEqual(1);
  });

  it('returns finite numbers for every descriptor, even on digital silence', () => {
    // Silence is a real file people have. Nothing here may be NaN, because a NaN
    // reaches the database and then poisons every percentile in the library.
    const features = extractFeatures(new Float32Array(60 * RATE), RATE);
    const numbers = [
      features.bpm,
      features.bpmConfidence,
      features.keyStrength,
      features.keyMargin,
      features.rmsMean,
      features.crestFactor,
      features.centroidHzMean,
      features.fluxMean,
      features.zcrMean,
      features.danceabilityRaw,
    ];
    for (const value of numbers) expect(Number.isFinite(value)).toBe(true);
    // Silence has no level at all, so decibels are legitimately minus infinity.
    expect(features.loudnessDb).toBe(-Infinity);
  });

  it('records where each window came from', () => {
    const features = extractFeatures(synthTrack(120, 120, [60]), RATE);
    const starts = features.windows.map((window) => window.startSec);
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
    expect(starts[0]).toBeGreaterThan(0);
  });

  it('reports progress through every stage in order', () => {
    const seen: Stage[] = [];
    extractFeatures(synthTrack(120, 60, [60]), RATE, {
      onProgress: (stage) => {
        if (seen[seen.length - 1] !== stage) seen.push(stage);
      },
    });
    expect(seen).toEqual(['windowing', 'spectral', 'rhythm', 'tonal', 'finalizing']);
  });

  it('stops at the next stage boundary when cancelled', () => {
    let calls = 0;
    try {
      extractFeatures(synthTrack(120, 60, [60]), RATE, {
        shouldCancel: () => {
          calls++;
          return calls > 2;
        },
      });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as ExtractionError).code).toBe('cancelled');
    }
  });

  it('handles a short track as a single window without complaining', () => {
    const features = extractFeatures(synthTrack(120, 20, [60, 64, 67]), RATE);
    expect(features.windows).toHaveLength(1);
    expect(features.windows[0]?.startSec).toBe(0);
  });
});
