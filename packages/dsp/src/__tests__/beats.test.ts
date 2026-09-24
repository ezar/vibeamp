/**
 * Finding the beat, not just the tempo.
 *
 * Every test here builds a signal whose beats are at a known instant and then asks
 * where they are, because the whole value of this number is that it is right to
 * within a fraction of a beat. A phase that is merely plausible is a fade that
 * starts audibly early.
 */

import { describe, expect, it } from 'vitest';
import { MIN_GRID_STRENGTH, beatGrid } from '../beats.js';
import { onsetEnvelope } from '../onset.js';

const RATE = 16_000;

/**
 * A kick on every beat, starting at `offsetSec`.
 *
 * A short burst of noise through a decaying envelope: broadband, so the spectral
 * flux sees it, and short, so the onset is where the beat is rather than smeared
 * across it.
 */
function pulses(bpm: number, seconds: number, offsetSec: number, accentEvery = 0): Float32Array {
  const out = new Float32Array(Math.round(RATE * seconds));
  const period = (60 / bpm) * RATE;
  let state = 12_345;
  const random = (): number => (state = (state * 1664525 + 1013904223) >>> 0) / 4294967296;

  for (let beat = 0; ; beat += 1) {
    const start = Math.round(offsetSec * RATE + beat * period);
    if (start >= out.length) break;
    const loud = accentEvery > 0 && beat % accentEvery === 0 ? 1 : 0.6;
    for (let i = 0; i < Math.round(RATE * 0.05); i += 1) {
      const at = start + i;
      if (at < 0 || at >= out.length) continue;
      out[at] = (random() * 2 - 1) * loud * Math.exp(-i / (RATE * 0.01));
    }
  }
  return out;
}

/** How far a measured phase is from the truth, in seconds, the short way round. */
function phaseError(measured: number, expected: number, period: number): number {
  const raw = Math.abs(measured - expected) % period;
  return Math.min(raw, period - raw);
}

describe('finding the phase', () => {
  it('puts the grid on the beats, wherever they start', () => {
    const period = 60 / 120;
    for (const offset of [0, 0.12, 0.25, 0.37]) {
      const envelope = onsetEnvelope(pulses(120, 12, offset), RATE);
      const grid = beatGrid(envelope, 120);
      expect(grid).not.toBeNull();
      // Within a twentieth of a beat: 25ms at 120 BPM, which is below what anyone
      // hears as an early or late entry.
      expect(phaseError(grid?.phaseSec ?? 0, offset, period)).toBeLessThan(period / 20);
    }
  });

  it('works at the tempos a collection actually holds', () => {
    for (const bpm of [92, 128, 174]) {
      const period = 60 / bpm;
      const envelope = onsetEnvelope(pulses(bpm, 12, 0.2), RATE);
      const grid = beatGrid(envelope, bpm);
      expect(phaseError(grid?.phaseSec ?? 0, 0.2, period)).toBeLessThan(period / 20);
    }
  });

  it('is confident about a machine and unconvinced by noise', () => {
    // The two numbers the usable-grid threshold sits between. Pinned, because the
    // threshold is only defensible while the gap is this wide.
    const machine = beatGrid(onsetEnvelope(pulses(120, 12, 0), RATE), 120);
    expect(machine?.strength ?? 0).toBeGreaterThan(0.8);

    let state = 99;
    const noise = new Float32Array(RATE * 12).map(() => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return (state / 4294967296) * 2 - 1;
    });
    const flat = beatGrid(onsetEnvelope(noise, RATE), 120);
    // Nothing starts anywhere in white noise, so no offset genuinely beats any
    // other — but the best of thirty-two noisy candidates always beats their
    // average, so this never reaches zero and the threshold has to allow for it.
    expect(flat?.strength ?? 1).toBeLessThan(0.3);
    expect(flat?.strength ?? 1).toBeLessThan(MIN_GRID_STRENGTH);
    expect(machine?.strength ?? 0).toBeGreaterThan(MIN_GRID_STRENGTH);
  });

  it('runs a fixed fraction of a frame ahead of the audio, at any rate', () => {
    // The correction inside `beatGrid` rests on this. If a change to the framing
    // or the flux moves it, every grid goes a tenth of a beat out and nothing else
    // in the suite would notice.
    for (const rate of [8000, 16_000]) {
      const signal = new Float32Array(rate * 3);
      let state = 5;
      for (let i = 0; i < Math.round(rate * 0.05); i += 1) {
        state = (state * 1664525 + 1013904223) >>> 0;
        signal[Math.round(rate) + i] =
          ((state / 4294967296) * 2 - 1) * Math.exp(-i / (rate * 0.01));
      }
      const envelope = onsetEnvelope(signal, rate);
      let peak = 0;
      for (let i = 0; i < envelope.strength.length; i += 1) {
        if ((envelope.strength[i] ?? 0) > (envelope.strength[peak] ?? 0)) peak = i;
      }
      // The peak lands early, and adding the declared lead puts it back on the
      // sound to within one envelope frame.
      const corrected = peak / envelope.rate + envelope.leadSec;
      expect(Math.abs(corrected - 1)).toBeLessThan(1 / envelope.rate);
    }
  });

  it('refuses what it cannot measure', () => {
    // Two beats is not a grid.
    expect(beatGrid(onsetEnvelope(pulses(120, 1, 0), RATE), 120)).toBeNull();
    // A tempo the estimator returns when it found none.
    expect(beatGrid(onsetEnvelope(pulses(120, 12, 0), RATE), 0)).toBeNull();
    expect(beatGrid(onsetEnvelope(new Float32Array(RATE * 12), RATE), 120)).toBeNull();
  });
});
