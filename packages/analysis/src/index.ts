/**
 * vibeamp analysis pipeline.
 *
 * The worker protocol and the extraction it wraps. DOM-free on purpose: the worker
 * entry point in `apps/web` is a few lines of message plumbing around
 * {@link extractFeatures}, so the pipeline itself is tested in Node.
 */

export {
  WINDOW_SEC,
  WINDOW_POSITIONS,
  SHORT_TRACK_SEC,
  MIN_ANALYSABLE_SEC,
  TEMPO_WINDOW_SEC,
  TEMPO_WINDOW_POSITION,
  planWindows,
} from './windows.js';
export type { SampleWindow, WindowPlan } from './windows.js';
export {
  ANALYSIS_VERSION,
  TARGET_SAMPLE_RATE,
  RETRYABLE_CODES,
  MAX_ATTEMPTS,
  JOB_TIMEOUT_MS,
  isRetryable,
} from './protocol.js';
export type {
  Stage,
  AnalyzeRequest,
  ToWorker,
  FromWorker,
  WorkerError,
  WorkerErrorCode,
} from './protocol.js';
export { extractFeatures, ExtractionError } from './extract.js';
export type { ExtractOptions } from './extract.js';
