/**
 * A vibe in a URL.
 *
 * The five sliders and the curve are the whole of what the planner is told, and
 * none of it refers to a particular track: they are positions on percentiles that
 * each library computes for itself. So the same six numbers mean "loud for this
 * collection, bright for this collection" wherever they land, and a link can carry
 * a setting from one person's records to another's without carrying any music.
 *
 * That is the one thing this player can share. Nothing else here is shareable
 * without a server, and this needs none.
 *
 * This is the codec only. Turning a code into a URL lives in the app, because this
 * package must keep running in Node and in workers, where there is no page to take
 * a link from.
 *
 * The format is fixed width and versioned: twelve characters, a leading version,
 * five bytes of slider and one digit of curve. Versioned because the sliders are
 * the product and will change, and a link from an older release must be refused
 * rather than misread — five values decoded into six sliders is not an error the
 * reader would notice.
 */

import type { EnergyShape, VibeTarget } from '@vibeamp/core';

/** The current format. Bump it when the fields below change meaning or number. */
const VERSION = '1';

/** The sliders, in the order they are packed. Changing this changes the format. */
const FIELDS = [
  'energy',
  'brightness',
  'danceability',
  'familiarity',
  'coherence',
] as const satisfies ReadonlyArray<keyof VibeTarget>;

/** The curves, in the order they are numbered. Append only. */
const SHAPES = ['flat', 'rise', 'arc', 'winddown'] as const satisfies readonly EnergyShape[];

/** Characters in a well-formed code: version, five bytes, one digit. */
const LENGTH = 1 + FIELDS.length * 2 + 1;

export interface Vibe {
  target: VibeTarget;
  shape: EnergyShape;
}

/**
 * Pack a vibe into the code that goes in the `vibe` query parameter.
 *
 * Each slider becomes one byte, which is about a third of a percent of travel —
 * finer than anyone can set a 64 pixel fader, and short enough that the whole
 * link fits in a message.
 */
export function encodeVibe({ target, shape }: Vibe): string {
  const sliders = FIELDS.map((field) => byteOf(target[field]).toString(16).padStart(2, '0')).join(
    '',
  );
  // An unknown shape would otherwise pack as -1 and decode as something else.
  const index = SHAPES.indexOf(shape);
  return `${VERSION}${sliders}${index === -1 ? 0 : index}`;
}

/**
 * Read a code back.
 *
 * @returns `null` for anything that is not a code this version wrote: a different
 *   version, the wrong length, characters that are not hex, a curve that does not
 *   exist. Refusing is the point — a half-understood vibe is worse than none,
 *   because the queue would reorder and the sliders would not say why.
 */
export function decodeVibe(code: string): Vibe | null {
  if (code.length !== LENGTH) return null;
  if (code[0] !== VERSION) return null;

  const target: Partial<Record<keyof VibeTarget, number>> = {};
  for (const [index, field] of FIELDS.entries()) {
    const at = 1 + index * 2;
    const byte = Number.parseInt(code.slice(at, at + 2), 16);
    if (!Number.isInteger(byte)) return null;
    target[field] = byte / 255;
  }

  const shape = SHAPES[Number.parseInt(code[LENGTH - 1] ?? '', 10)];
  if (shape === undefined) return null;

  return { target: target as VibeTarget, shape };
}

/** 0..1 to 0..255, with anything unusable landing in the middle rather than at an end. */
function byteOf(value: number): number {
  if (!Number.isFinite(value)) return 128;
  return Math.round(Math.min(1, Math.max(0, value)) * 255);
}
