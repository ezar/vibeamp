/**
 * The MilkDrop preset library.
 *
 * Butterchurn's preset packages predate modules and are published as UMD bundles,
 * so what an `import` gives back is not the preset map it looks like: the default
 * export is a class whose static `getPresets()` returns the map. Reading the module
 * as a map yields no presets at all, and butterchurn then renders its built-in
 * fallback for ever — which looks like a working visualiser stuck on one pattern.
 *
 * Both shapes are accepted because the package has published both across versions,
 * and neither is worth a runtime failure.
 */

import type { Preset } from 'webamp';

interface PresetSource {
  getPresets?: () => Record<string, object>;
}

/** Load the preset pack and put it in the shape Webamp asks for. */
export async function milkdropPresets(): Promise<Preset[]> {
  const module = await import('butterchurn-presets/lib/butterchurnPresetsMinimal.min.js');
  return toPresets((module.default ?? module) as PresetSource);
}

/**
 * Map whatever the package exported onto Webamp's `Preset[]`.
 *
 * Exported for the test, which runs it over the real package: mocking the module
 * here would only assert that this function agrees with my idea of its shape, and
 * that idea is exactly what was wrong.
 */
export function toPresets(source: PresetSource | Record<string, object>): Preset[] {
  const map =
    typeof (source as PresetSource).getPresets === 'function'
      ? (source as Required<PresetSource>).getPresets()
      : (source as Record<string, object>);

  return Object.entries(map)
    .filter(([, butterchurnPresetObject]) => typeof butterchurnPresetObject === 'object')
    .map(([name, butterchurnPresetObject]) => ({ name, butterchurnPresetObject }));
}
