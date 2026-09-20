/**
 * Declarations for the two MilkDrop packages, which ship none of their own.
 *
 * Typed only as far as this app uses them. `butterchurn` is handed straight to
 * Webamp, which asks for it as an opaque module, so the surface here is the shape
 * of the import rather than of the visualiser.
 *
 * These are assertions, not checks: a declaration that is wrong compiles and then
 * fails silently at runtime. The presets module was declared here as a map of
 * presets and is really a class with a static `getPresets`, which is why MilkDrop
 * shipped with none. `presets.test.ts` imports the real package and holds this
 * file honest.
 */

declare module 'butterchurn' {
  const butterchurn: unknown;
  export default butterchurn;
}

declare module 'butterchurn-presets/lib/butterchurnPresetsMinimal.min.js' {
  /** Preset name to the preset's own equation object, which only butterchurn reads. */
  export type PresetMap = Record<string, object>;

  const presets: { getPresets?: () => PresetMap };
  export default presets;
}
