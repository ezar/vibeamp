/**
 * vibeamp auto-DJ.
 *
 * Takes tracks with descriptors and a vibe target and returns an ordered queue.
 * No DOM and no storage: the planner is a pure function of its inputs, which is
 * what makes a queue reproducible from a seed in the tests.
 */

export { targetEnergy, ENERGY_SHAPE_LABELS } from './energyCurve.js';
export {
  DEFAULT_WEIGHTS,
  BPM_TOLERANCE,
  bpmCost,
  relativeBpmDistance,
  keyReliability,
  KEY_STRENGTH_FLOOR,
  KEY_STRENGTH_CEILING,
  noveltyCost,
  scoreCandidate,
  weightsForCoherence,
} from './scoring.js';
export type { QueueContext, ScoreWeights } from './scoring.js';
export { planQueue, canAutoDj, MIN_ANALYSED_TRACKS, SHORTLIST_SIZE } from './queue.js';
export type { PlanOptions, PlannedTrack } from './queue.js';
export { explainTransition, keyRelationLabel } from './explain.js';
export type { KeyRelation, Transition } from './explain.js';
export { VIBE_PRESETS } from './presets.js';
export { encodeVibe, decodeVibe } from './vibeLink.js';
export type { Vibe } from './vibeLink.js';
export type { VibePreset } from './presets.js';
export { alignIncoming, gridOf } from './align.js';
export type { BeatAlignment, TrackGrid } from './align.js';
export { setSheet } from './setSheet.js';
export type { SetSheetRow } from './setSheet.js';
