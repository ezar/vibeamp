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
