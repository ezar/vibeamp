/**
 * The two numbers a join is recognised by, measured through the real pipeline.
 *
 * `segue.ts` chooses its thresholds from these, so they are pinned here: a change
 * to the analysis that moves them would otherwise leave the thresholds sitting in
 * the wrong place with nothing to say so.
 *
 * The case that must not move is the fade-in. A fade is how a record begins, and a
 * player that decided a fade-in was the middle of a piece of music would cut into
 * it every time.
 */

import { describe, expect, it } from 'vitest';
import { ENDS_RUNNING, STARTS_RUNNING } from '@vibeamp/core';
import { extractFeatures } from '../extract.js';

const RATE = 16_000;

/** A minute of music with a pulse: two tones and a kick on every beat. */
function body(seconds = 60): Float32Array {
  const out = new Float32Array(Math.round(seconds * RATE));
  let state = 7;
  for (let i = 0; i < out.length; i += 1) {
    state = (state * 1664525 + 1013904223) >>> 0;
    out[i] =
      0.3 * Math.sin((2 * Math.PI * 220 * i) / RATE) +
      0.1 * Math.sin((2 * Math.PI * 330 * i) / RATE) +
      (state / 4294967296 - 0.5) * 0.02;
  }
  const period = Math.round((60 / 120) * RATE);
  for (let beat = 0; beat * period < out.length; beat += 1) {
    for (let i = 0; i < Math.round(0.03 * RATE); i += 1) {
      const at = beat * period + i;
      if (at < out.length) out[at] = (out[at] ?? 0) + 0.5 * Math.exp((-6 * i) / (0.03 * RATE));
    }
  }
  return out;
}

/** The same, with a linear fade in over `seconds`. */
function fadedIn(seconds: number): Float32Array {
  const out = body();
  const length = Math.round(seconds * RATE);
  for (let i = 0; i < length; i += 1) out[i] = (out[i] ?? 0) * (i / length);
  return out;
}

describe('how a track begins', () => {
  it('scores a running start well above the threshold', () => {
    // Cut out of continuous music: there is nothing before it, because the file
    // starts mid-phrase. Measured at 1.017.
    const head = extractFeatures(body(), RATE).headRatio;
    expect(head).toBeGreaterThan(0.9);
    expect(head).toBeGreaterThan(STARTS_RUNNING);
  });

  it('scores every way a record actually begins well below it', () => {
    // A fade-in is how a record begins, and the one case a player must never cut
    // into. Measured: one second 0.142, half a second 0.283, silence 0.000.
    for (const [seconds, ceiling] of [
      [1, 0.2],
      [0.5, 0.35],
    ] as const) {
      const head = extractFeatures(fadedIn(seconds), RATE).headRatio;
      expect(head).toBeLessThan(ceiling);
      expect(head).toBeLessThan(STARTS_RUNNING);
    }

    const silent = body();
    for (let i = 0; i < Math.round(0.4 * RATE); i += 1) silent[i] = 0;
    expect(extractFeatures(silent, RATE).headRatio).toBeLessThan(0.05);
  });
});

describe('how a track ends', () => {
  it('tells a fade-out from a track that runs to its last sample', () => {
    // Measured: 0.047 against 0.982.
    const faded = body();
    for (let i = 0; i < RATE * 3; i += 1) {
      const at = faded.length - RATE * 3 + i;
      faded[at] = (faded[at] ?? 0) * (1 - i / (RATE * 3));
    }
    expect(extractFeatures(faded, RATE).tailRatio).toBeLessThan(ENDS_RUNNING);
    expect(extractFeatures(body(), RATE).tailRatio).toBeGreaterThan(ENDS_RUNNING);
  });
});
