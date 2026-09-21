/**
 * vibeamp domain model.
 *
 * Types, the Camelot wheel and library-relative normalisation. No DOM, no storage
 * and no Web Audio, so the analysis pipeline and the DJ engine can both depend on
 * it and both stay testable in Node.
 */

export * from './types.js';
export { toCamelot, parseCamelot, camelotDistance, compatibleCodes } from './camelot.js';
export type { CamelotCode, ParsedCamelot } from './camelot.js';
export {
  BUCKET_COUNT,
  MIN_TRACKS_FOR_PERCENTILES,
  DEFAULT_RANGES,
  createHistogram,
  createLibraryStatistics,
  addSample,
  percentileOf,
  descriptorInputs,
  recordFeatures,
  recordInputs,
  normaliseFeatures,
  renormalise,
} from './normalise.js';
export type { Histogram, LibraryStatistics, NormalisedDescriptor } from './normalise.js';
export { findDuplicates, pairDistance, DUPLICATE_THRESHOLD } from './duplicates.js';
export type { DuplicateGroup, DuplicateOptions, DuplicateVerdict } from './duplicates.js';
export {
  encodeFingerprint,
  decodeFingerprint,
  fingerprintDistance,
  FINGERPRINT_SEGMENTS,
  FINGERPRINT_FRAMES,
  FINGERPRINT_BINS,
  FINGERPRINT_BYTES,
} from './fingerprint.js';
