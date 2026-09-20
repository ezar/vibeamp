/**
 * Declarations for the two MilkDrop packages, which ship none of their own.
 *
 * Typed only as far as this app uses them. `butterchurn` is handed straight to
 * Webamp, which asks for it as an opaque module, so the surface here is the shape
 * of the import rather than of the visualiser.
 */

declare module 'butterchurn' {
  const butterchurn: unknown;
  export default butterchurn;
}

declare module 'butterchurn-presets/lib/butterchurnPresetsMinimal.min.js' {
  /** Preset name to the preset's own equation object, which only butterchurn reads. */
  const presets: Record<string, object>;
  export default presets;
}
