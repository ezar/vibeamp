import { describe, expect, it } from 'vitest';

import { decodeVibe, encodeVibe } from '../vibeLink.js';
import { VIBE_PRESETS } from '../presets.js';
import { NEUTRAL_TARGET } from './tracks.js';

describe('encodeVibe', () => {
  it('is short enough to paste into a message', () => {
    expect(encodeVibe({ target: NEUTRAL_TARGET, shape: 'arc' })).toHaveLength(12);
  });

  it('starts with the format version, so an old link can be refused', () => {
    expect(encodeVibe({ target: NEUTRAL_TARGET, shape: 'flat' }).startsWith('1')).toBe(true);
  });
});

describe('round trip', () => {
  it('returns every preset close enough that no fader would show the difference', () => {
    // A byte per slider is about a third of a percent of travel.
    for (const preset of VIBE_PRESETS) {
      const back = decodeVibe(encodeVibe({ target: preset.target, shape: preset.shape }));

      expect(back?.shape).toBe(preset.shape);
      for (const [key, value] of Object.entries(preset.target)) {
        expect(back?.target[key as keyof typeof preset.target]).toBeCloseTo(value, 2);
      }
    }
  });

  it('keeps the ends exactly, which is where people park a slider', () => {
    const extremes = {
      energy: 0,
      brightness: 1,
      danceability: 0,
      familiarity: 1,
      coherence: 0,
    };
    const back = decodeVibe(encodeVibe({ target: extremes, shape: 'winddown' }));

    expect(back?.target).toEqual(extremes);
  });

  it('distinguishes every curve', () => {
    for (const shape of ['flat', 'rise', 'arc', 'winddown'] as const) {
      expect(decodeVibe(encodeVibe({ target: NEUTRAL_TARGET, shape }))?.shape).toBe(shape);
    }
  });
});

describe('decodeVibe', () => {
  it('refuses a code from a version it does not know', () => {
    const code = encodeVibe({ target: NEUTRAL_TARGET, shape: 'arc' });

    // The regression this guards: five values read into six sliders is not an
    // error anyone would notice, it is a queue that reorders for no stated reason.
    expect(decodeVibe(`2${code.slice(1)}`)).toBeNull();
  });

  it('refuses anything that is not the right shape', () => {
    for (const code of ['', '1', 'nonsense', '18066737f4c', '18066737f4c22', '1zzzzzzzzzz2']) {
      expect(decodeVibe(code)).toBeNull();
    }
  });

  it('refuses a curve that does not exist', () => {
    const code = encodeVibe({ target: NEUTRAL_TARGET, shape: 'arc' });

    expect(decodeVibe(`${code.slice(0, -1)}9`)).toBeNull();
  });
});

describe('what a link cannot carry', () => {
  it('holds nothing but the six numbers', () => {
    // The point of the format: a vibe refers to percentiles each library computes
    // for itself, so the link names no track, no path and no library.
    const code = encodeVibe({ target: NEUTRAL_TARGET, shape: 'arc' });

    expect(code).toMatch(/^[0-9a-f]+$/);
  });
});
