/**
 * The worker protocol.
 *
 * The constraint that shapes everything: `decodeAudioData` is not available in a
 * worker. Decoding therefore happens on the main thread, and what crosses to the
 * worker is an already decoded `Float32Array`, transferred rather than copied.
 *
 * So the worker never touches a file, never touches the database and does not know
 * what a track is. It receives samples and returns numbers, which is what makes it
 * testable without a browser.
 */

import type { RawFeatures } from '@vibeamp/core';

export { ANALYSIS_VERSION, TARGET_SAMPLE_RATE } from '@vibeamp/core';

/** Stage of one job, for the progress display and the debug panel. */
export type Stage = 'windowing' | 'rhythm' | 'tonal' | 'spectral' | 'finalizing';

export interface AnalyzeRequest {
  jobId: string;
  /** Mono samples, transferred. Ownership passes to the worker. */
  samples: Float32Array;
  /** Passed explicitly rather than assumed: Safari does not always resample. */
  sampleRate: number;
  durationSec: number;
}

export type ToWorker =
  | { type: 'init'; payload: { analysisVersion: number } }
  | { type: 'analyze'; payload: AnalyzeRequest }
  | { type: 'cancel'; payload: { jobId: string } }
  | { type: 'dispose' };

/**
 * Why a job failed.
 *
 * There is no `wasm_init` or `oom`: the descriptors are plain TypeScript, so there
 * is no WebAssembly heap to fail to initialise or to exhaust. See
 * `docs/decisions/0002-descriptors-in-typescript.md`.
 */
export type WorkerErrorCode =
  /** The samples were not usable: empty, or not finite. Never retried. */
  | 'bad_input'
  /** Shorter than the shortest analysable track. Never retried. */
  | 'too_short'
  /** A descriptor threw. Retried, because it may be data dependent. */
  | 'algorithm'
  /** The pool withdrew the job. */
  | 'cancelled';

export interface WorkerError {
  jobId: string;
  code: WorkerErrorCode;
  message: string;
  /** When true the worker is in an undefined state; the pool replaces it. */
  fatal: boolean;
}

export type FromWorker =
  | { type: 'ready'; payload: { analysisVersion: number } }
  | { type: 'progress'; payload: { jobId: string; stage: Stage; pct: number } }
  | { type: 'result'; payload: { jobId: string; features: RawFeatures } }
  | { type: 'error'; payload: WorkerError };

/** Error codes that a retry could plausibly fix. */
export const RETRYABLE_CODES: readonly WorkerErrorCode[] = ['algorithm'];

/** Attempts before a track is given up on. */
export const MAX_ATTEMPTS = 3;

/** How long the pool waits for a job before replacing the worker, in milliseconds. */
export const JOB_TIMEOUT_MS = 60_000;

/** Whether a failure is worth another attempt. */
export function isRetryable(code: WorkerErrorCode, attempts: number): boolean {
  return RETRYABLE_CODES.includes(code) && attempts < MAX_ATTEMPTS;
}
