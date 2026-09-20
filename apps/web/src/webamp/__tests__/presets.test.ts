import { describe, expect, it } from 'vitest';

import { milkdropPresets, toPresets } from '../presets.js';

describe('milkdropPresets', () => {
  it('loads presets from the real package', async () => {
    // The regression this exists for: the package's default export is a class with
    // a static getPresets(), not the preset map it was declared as, so reading it
    // as a map handed Webamp an empty list and MilkDrop rendered one fixed pattern
    // for ever. Nothing failed, nothing logged. Only the real module catches this.
    const presets = await milkdropPresets();

    expect(presets.length).toBeGreaterThan(10);
    for (const preset of presets) {
      expect(typeof preset.name).toBe('string');
      expect(preset.name.length).toBeGreaterThan(0);
      // Webamp's Preset is a union of an inline preset and a URL to fetch one.
      // These are inline, which is what keeps the visualiser working offline.
      expect('butterchurnPresetObject' in preset).toBe(true);
    }
  });
});

describe('toPresets', () => {
  it('reads a package that exports getPresets', () => {
    const presets = toPresets({ getPresets: () => ({ one: { a: 1 }, two: { b: 2 } }) });

    expect(presets.map((preset) => preset.name)).toEqual(['one', 'two']);
  });

  it('reads a package that exports the map directly', () => {
    const presets = toPresets({ one: { a: 1 } });

    expect(presets).toEqual([{ name: 'one', butterchurnPresetObject: { a: 1 } }]);
  });
});
