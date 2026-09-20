/**
 * The energy curve.
 *
 * A queue is not a flat list of similar tracks; it is a walk along a target curve.
 * The user picks the shape, the planner asks the curve where it should be at each
 * position, and the scorer looks for the track nearest that target.
 */

import type { EnergyShape } from '@vibeamp/core';

/** How far `rise` and `winddown` travel from the seed over a whole session, 0..1. */
const TRAVEL = 0.5;
/** How high `arc` lifts above the seed at its peak, 0..1. */
const ARC_HEIGHT = 0.45;

/**
 * Target energy at a position in the session.
 *
 * @param shape The curve the user chose.
 * @param position How far through the planned session, 0 at the seed, 1 at the end.
 * @param seed Energy of the track the session started from, 0..1.
 * @returns Target energy, 0..1.
 */
export function targetEnergy(shape: EnergyShape, position: number, seed: number): number {
  const at = clamp01(position);
  switch (shape) {
    case 'flat':
      return clamp01(seed);
    case 'rise':
      return clamp01(seed + TRAVEL * at);
    case 'winddown':
      return clamp01(seed - TRAVEL * at);
    case 'arc':
      // A half sine: up, a plateau over the middle, and back down by the end.
      return clamp01(seed + ARC_HEIGHT * Math.sin(Math.PI * at));
  }
}

/** Human-readable name of each shape, for the UI. */
export const ENERGY_SHAPE_LABELS: Record<EnergyShape, string> = {
  flat: 'Hold',
  rise: 'Build',
  arc: 'Arc',
  winddown: 'Wind down',
};

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}
