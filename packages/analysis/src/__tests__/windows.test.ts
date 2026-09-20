import { describe, expect, it } from 'vitest';
import {
  MIN_ANALYSABLE_SEC,
  SHORT_TRACK_SEC,
  WINDOW_POSITIONS,
  WINDOW_SEC,
  planWindows,
} from '../windows.js';

const RATE = 16000;

describe('planWindows', () => {
  it('refuses a track too short to hold anything', () => {
    expect(planWindows(Math.round(2 * RATE), RATE)).toBeNull();
    expect(planWindows(0, RATE)).toBeNull();
  });

  it('analyses a short track whole, as one window', () => {
    const samples = Math.round((SHORT_TRACK_SEC - 5) * RATE);
    const plan = planWindows(samples, RATE);
    expect(plan?.descriptor).toHaveLength(1);
    expect(plan?.descriptor[0]).toEqual({ offset: 0, length: samples, startSec: 0 });
    expect(plan?.tempo.length).toBe(samples);
  });

  it('takes three windows from a full length track', () => {
    const durationSec = 300;
    const plan = planWindows(durationSec * RATE, RATE);
    expect(plan?.descriptor).toHaveLength(3);

    plan?.descriptor.forEach((window, index) => {
      expect(window.length).toBe(WINDOW_SEC * RATE);
      expect(window.startSec).toBeCloseTo((WINDOW_POSITIONS[index] ?? 0) * durationSec, 1);
    });
  });

  it('never lets a window run past the end of the signal', () => {
    // The 80 per cent window of a 40 second track would otherwise ask for samples
    // that do not exist, and the padding would be analysed as if it were music.
    for (const durationSec of [36, 40, 45, 60, 300]) {
      const total = Math.round(durationSec * RATE);
      const plan = planWindows(total, RATE);
      for (const window of plan?.descriptor ?? []) {
        expect(window.offset + window.length).toBeLessThanOrEqual(total);
        expect(window.offset).toBeGreaterThanOrEqual(0);
      }
      expect((plan?.tempo.offset ?? 0) + (plan?.tempo.length ?? 0)).toBeLessThanOrEqual(total);
    }
  });

  it('gives tempo a longer window than the descriptors get', () => {
    const plan = planWindows(300 * RATE, RATE);
    expect(plan?.tempo.length).toBeGreaterThan(plan?.descriptor[0]?.length ?? 0);
  });

  it('works at any sample rate, not just the target one', () => {
    for (const rate of [8000, 16000, 44100, 48000]) {
      const plan = planWindows(120 * rate, rate);
      expect(plan?.descriptor).toHaveLength(3);
      expect(plan?.descriptor[0]?.length).toBe(WINDOW_SEC * rate);
    }
  });

  it('treats the boundary duration consistently', () => {
    expect(planWindows(Math.round(MIN_ANALYSABLE_SEC * RATE), RATE)).not.toBeNull();
    expect(planWindows(Math.round(SHORT_TRACK_SEC * RATE), RATE)?.descriptor).toHaveLength(3);
  });
});
