/**
 * Telling dead air from quiet music.
 *
 * The two mistakes here are not symmetric. Missing four seconds of silence at the
 * head of a rip leaves a hole in a set; trimming the first four seconds of somebody's
 * quiet intro edits their record. So most of these tests are about what must *not*
 * be cut.
 */

import { describe, expect, it } from 'vitest';
import { soundEdges } from '../edges.js';

const RATE = 16_000;

/** A tone at `level`, from `fromSec` to `toSec`, in a file `seconds` long. */
function tone(seconds: number, fromSec: number, toSec: number, level = 0.3): Float32Array {
  const out = new Float32Array(Math.round(seconds * RATE));
  const from = Math.round(fromSec * RATE);
  const to = Math.round(toSec * RATE);
  for (let i = from; i < Math.min(to, out.length); i += 1) {
    out[i] = level * Math.sin((2 * Math.PI * 220 * i) / RATE);
  }
  return out;
}

describe('finding the music', () => {
  it('finds both ends of a track padded with silence', () => {
    const edges = soundEdges(tone(20, 4, 16), RATE);
    expect(edges?.startSec ?? -1).toBeCloseTo(4, 1);
    expect(edges?.endSec ?? -1).toBeCloseTo(16, 1);
  });

  it('leaves a track with no padding alone', () => {
    const edges = soundEdges(tone(20, 0, 20), RATE);
    expect(edges?.startSec ?? -1).toBeCloseTo(0, 2);
    expect(edges?.endSec ?? -1).toBeCloseTo(20, 1);
  });

  it('does not mistake a click in the lead-in for the start', () => {
    // A tape pop four seconds before the music. One frame cannot carry a window.
    const samples = tone(20, 8, 18);
    const at = Math.round(4 * RATE);
    for (let i = 0; i < Math.round(0.01 * RATE); i += 1) samples[at + i] = 0.9;
    expect(soundEdges(samples, RATE)?.startSec ?? -1).toBeCloseTo(8, 1);
  });

  it('does not trim a quiet intro', () => {
    // Twelve decibels below the rest of the track, which is a hushed opening and
    // not silence. The floor is forty decibels down for exactly this reason.
    const samples = tone(20, 0, 20, 0.3);
    for (let i = 0; i < Math.round(5 * RATE); i += 1) {
      samples[i] = (samples[i] ?? 0) * 0.25;
    }
    expect(soundEdges(samples, RATE)?.startSec ?? -1).toBeCloseTo(0, 2);
  });

  it('does not trim a fade-out, only what comes after it', () => {
    // A fade is the end of the music. What follows the fade is not.
    const samples = tone(20, 0, 15);
    const fadeFrom = Math.round(10 * RATE);
    const fadeTo = Math.round(15 * RATE);
    for (let i = fadeFrom; i < fadeTo; i += 1) {
      samples[i] = (samples[i] ?? 0) * (1 - (i - fadeFrom) / (fadeTo - fadeFrom));
    }
    const endSec = soundEdges(samples, RATE)?.endSec ?? -1;
    // Most of the fade survives; the very tail of it is below the floor, as it is
    // for any fade that reaches zero.
    expect(endSec).toBeGreaterThan(13.5);
    expect(endSec).toBeLessThanOrEqual(15.1);
  });

  it('keeps a rest in the middle of the music', () => {
    const samples = tone(20, 0, 20);
    for (let i = Math.round(9 * RATE); i < Math.round(11 * RATE); i += 1) samples[i] = 0;
    const edges = soundEdges(samples, RATE);
    expect(edges?.startSec ?? -1).toBeCloseTo(0, 2);
    expect(edges?.endSec ?? -1).toBeCloseTo(20, 1);
  });

  it('has nothing to say about a file of silence', () => {
    expect(soundEdges(new Float32Array(RATE * 10), RATE)).toBeNull();
    expect(soundEdges(new Float32Array(0), RATE)).toBeNull();
  });
});
