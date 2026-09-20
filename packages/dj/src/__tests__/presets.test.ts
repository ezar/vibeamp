import { describe, expect, it } from 'vitest';

import { ENERGY_SHAPE_LABELS } from '../energyCurve.js';
import { VIBE_PRESETS } from '../presets.js';

describe('VIBE_PRESETS', () => {
  it('has a unique id and a short label for each', () => {
    const ids = VIBE_PRESETS.map((preset) => preset.id);

    expect(new Set(ids).size).toBe(ids.length);
    for (const preset of VIBE_PRESETS) {
      expect(preset.label.length).toBeGreaterThan(0);
      // The row they sit in is 277px wide, and four of them have to fit.
      expect(preset.label.length).toBeLessThanOrEqual(5);
      expect(preset.title.length).toBeGreaterThan(0);
    }
  });

  it('names a curve the planner knows', () => {
    for (const preset of VIBE_PRESETS) {
      expect(ENERGY_SHAPE_LABELS[preset.shape]).toBeDefined();
    }
  });

  it('keeps every slider in range', () => {
    for (const preset of VIBE_PRESETS) {
      for (const value of Object.values(preset.target)) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
  });

  it('actually differs from one preset to the next', () => {
    // A set of presets that all mean the same thing is four buttons and no feature.
    const seen = new Set(
      VIBE_PRESETS.map((preset) => JSON.stringify([preset.target, preset.shape])),
    );

    expect(seen.size).toBe(VIBE_PRESETS.length);
  });
});
