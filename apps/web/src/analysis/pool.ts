/**
 * The worker pool, and the back pressure that keeps the tab alive.
 *
 * The rule that matters: **nothing is decoded until a worker is free to take it.**
 * A five minute track is about 19 MB of `Float32Array` at the analysis rate, and a
 * decoder running ahead of the workers accumulates them until the browser kills the
 * tab. Decoding is also single file by design, because it is the expensive half and
 * it has to happen on the main thread.
 */

import { JOB_TIMEOUT_MS, isRetryable } from '@vibeamp/analysis';
import type { FromWorker, Stage, ToWorker, WorkerError } from '@vibeamp/analysis';
import type { RawFeatures } from '@vibeamp/core';

/** Workers to run, given the machine. One core is left for the interface. */
export function defaultWorkerCount(hardwareConcurrency = navigator.hardwareConcurrency): number {
  return Math.min(4, Math.max(1, (hardwareConcurrency || 2) - 1));
}

export interface AnalysisJob {
  trackId: string;
  samples: Float32Array;
  sampleRate: number;
  durationSec: number;
  /** Side over mid, from the decoder. The worker cannot measure it itself. */
  sideRatio: number | null;
  /** Attempts already made, so the pool can decide whether a failure is final. */
  attempts: number;
}

export interface JobOutcome {
  trackId: string;
  features?: RawFeatures;
  error?: WorkerError;
  /** Whether the caller should put the track back in the queue. */
  retryable: boolean;
}

export interface PoolOptions {
  /** Builds a worker. Injected so the pool can be driven by a fake in tests. */
  createWorker: () => Worker;
  workerCount?: number;
  onProgress?: (trackId: string, stage: Stage, pct: number) => void;
}

interface Slot {
  worker: Worker;
  ready: boolean;
  job: PendingJob | null;
  /** Bare `setTimeout` rather than `window.setTimeout`, so the pool runs in Node
   *  too and the whole class is testable against a fake worker. */
  timeout: ReturnType<typeof setTimeout> | null;
}

interface PendingJob {
  job: AnalysisJob;
  jobId: string;
  resolve: (outcome: JobOutcome) => void;
}

/**
 * A pool of analysis workers with one job in flight per worker.
 *
 * `analyse` resolves when that track is done, so a caller can simply await it in a
 * loop and the back pressure follows from the pool having no free slot.
 */
export class AnalysisPool {
  private readonly slots: Slot[] = [];
  private readonly waiting: PendingJob[] = [];
  private readonly options: PoolOptions;
  private nextJobId = 0;
  private disposed = false;

  constructor(options: PoolOptions) {
    this.options = options;
    const count = options.workerCount ?? defaultWorkerCount();
    for (let i = 0; i < count; i++) this.slots.push(this.spawn());
  }

  /** How many workers are not currently busy. */
  freeSlots(): number {
    return this.slots.filter((slot) => slot.ready && slot.job === null).length;
  }

  /** Resolves once a worker is free, so a caller can decode just in time. */
  async waitForSlot(): Promise<void> {
    if (this.freeSlots() > 0) return;
    await new Promise<void>((resolve) => {
      const check = (): void => {
        if (this.disposed || this.freeSlots() > 0) resolve();
        else setTimeout(check, 25);
      };
      check();
    });
  }

  /**
   * Analyse one track.
   *
   * The samples are transferred, not copied, so `job.samples` is unusable to the
   * caller afterwards. That is the point: one 19 MB buffer, one owner.
   */
  async analyse(job: AnalysisJob): Promise<JobOutcome> {
    if (this.disposed) throw new Error('the pool has been disposed');

    return new Promise<JobOutcome>((resolve) => {
      const pending: PendingJob = { job, jobId: `job-${this.nextJobId++}`, resolve };
      const slot = this.slots.find((candidate) => candidate.ready && candidate.job === null);
      if (slot === undefined) this.waiting.push(pending);
      else this.dispatch(slot, pending);
    });
  }

  /**
   * Terminate every worker and settle every outstanding promise.
   *
   * In-flight jobs are settled as well as queued ones. Only draining the queue
   * leaves the caller awaiting a job whose worker has just been terminated, and that
   * promise never settles: the analysis loop stops without ever returning.
   */
  dispose(): void {
    this.disposed = true;

    const abandoned: PendingJob[] = [];
    for (const slot of this.slots) {
      if (slot.job !== null) abandoned.push(slot.job);
      slot.job = null;
      this.retire(slot);
    }
    this.slots.length = 0;
    abandoned.push(...this.waiting);
    this.waiting.length = 0;

    for (const pending of abandoned) {
      pending.resolve({
        trackId: pending.job.trackId,
        error: {
          jobId: pending.jobId,
          code: 'cancelled',
          message: 'the pool was disposed',
          fatal: false,
        },
        retryable: true,
      });
    }
  }

  // ---- internals ----

  private spawn(): Slot {
    const worker = this.options.createWorker();
    const slot: Slot = { worker, ready: false, job: null, timeout: null };

    worker.addEventListener('message', (event: MessageEvent<FromWorker>) => {
      this.handle(slot, event.data);
    });
    worker.addEventListener('error', () => {
      // An uncaught error leaves the worker in an unknown state, so it is replaced
      // rather than reused.
      this.fail(slot, {
        jobId: slot.job?.jobId ?? 'unknown',
        code: 'algorithm',
        message: 'the worker raised an uncaught error',
        fatal: true,
      });
    });

    const init: ToWorker = { type: 'init', payload: { analysisVersion: 1 } };
    worker.postMessage(init);
    return slot;
  }

  private dispatch(slot: Slot, pending: PendingJob): void {
    slot.job = pending;
    const message: ToWorker = {
      type: 'analyze',
      payload: {
        jobId: pending.jobId,
        samples: pending.job.samples,
        sampleRate: pending.job.sampleRate,
        durationSec: pending.job.durationSec,
        sideRatio: pending.job.sideRatio,
      },
    };
    slot.worker.postMessage(message, [pending.job.samples.buffer]);

    slot.timeout = setTimeout(() => {
      // Past the timeout the worker is not trusted to answer at all, so it is not
      // asked to cancel: it is terminated and replaced.
      this.fail(slot, {
        jobId: pending.jobId,
        code: 'algorithm',
        message: `no answer within ${JOB_TIMEOUT_MS} ms`,
        fatal: true,
      });
    }, JOB_TIMEOUT_MS);
  }

  private handle(slot: Slot, message: FromWorker): void {
    switch (message.type) {
      case 'ready':
        slot.ready = true;
        this.pump();
        return;

      case 'progress': {
        const trackId = slot.job?.job.trackId;
        if (trackId !== undefined) {
          this.options.onProgress?.(trackId, message.payload.stage, message.payload.pct);
        }
        return;
      }

      case 'result': {
        const pending = slot.job;
        if (pending === null || pending.jobId !== message.payload.jobId) return;
        this.clearTimeout(slot);
        slot.job = null;
        pending.resolve({
          trackId: pending.job.trackId,
          features: message.payload.features,
          retryable: false,
        });
        this.pump();
        return;
      }

      case 'error':
        this.fail(slot, message.payload);
        return;
    }
  }

  private fail(slot: Slot, error: WorkerError): void {
    const pending = slot.job;
    this.clearTimeout(slot);
    slot.job = null;

    if (pending !== null) {
      pending.resolve({
        trackId: pending.job.trackId,
        error,
        retryable: isRetryable(error.code, pending.job.attempts),
      });
    }

    if (error.fatal) this.replace(slot);
    this.pump();
  }

  /** Terminate a worker and stand a fresh one in its place. */
  private replace(slot: Slot): void {
    const index = this.slots.indexOf(slot);
    this.retire(slot);
    if (this.disposed || index === -1) return;
    this.slots[index] = this.spawn();
  }

  private retire(slot: Slot): void {
    this.clearTimeout(slot);
    slot.ready = false;
    slot.worker.terminate();
  }

  private clearTimeout(slot: Slot): void {
    if (slot.timeout !== null) clearTimeout(slot.timeout);
    slot.timeout = null;
  }

  /** Hand any queued job to the first free worker. */
  private pump(): void {
    if (this.disposed) return;
    for (const slot of this.slots) {
      if (!slot.ready || slot.job !== null) continue;
      const pending = this.waiting.shift();
      if (pending === undefined) return;
      this.dispatch(slot, pending);
    }
  }
}
