/**
 * Instrumentation for the debug panel.
 *
 * The specification's reason for this is exact: without it, tuning the auto-DJ
 * scoring is guessing. What it collects is where the analysis time actually goes,
 * what failed and why, and the descriptors of whatever is playing — the three
 * things you need in front of you to know whether a bad queue is the scoring's
 * fault or the descriptors'.
 *
 * The clock is injected, so the rolling means are testable without waiting for
 * real milliseconds to pass.
 */

import type { Stage } from '@vibeamp/analysis';
import type { WorkerErrorCode } from '@vibeamp/analysis';

/** Failures kept for the panel. Old ones fall off the end. */
const MAX_FAILURES = 20;

export interface StageTiming {
  stage: Stage;
  /** Mean wall-clock time in this stage, in milliseconds. */
  meanMs: number;
  samples: number;
}

export interface FailureRecord {
  trackId: string;
  code: WorkerErrorCode | 'decode';
  message: string;
  at: number;
}

export interface DebugSnapshot {
  /** Mean time per analysis stage, longest first. */
  stages: StageTiming[];
  /** Mean decode time, in milliseconds. The expensive half, on the main thread. */
  decodeMeanMs: number;
  /** Mean end-to-end time per track, in milliseconds. */
  trackMeanMs: number;
  tracksAnalysed: number;
  failures: FailureRecord[];
}

/** A running mean that never stores its samples. */
class RollingMean {
  private total = 0;
  private count = 0;

  add(value: number): void {
    if (!Number.isFinite(value) || value < 0) return;
    this.total += value;
    this.count++;
  }

  get mean(): number {
    return this.count === 0 ? 0 : this.total / this.count;
  }

  get samples(): number {
    return this.count;
  }
}

export class DebugStats {
  private readonly stages = new Map<Stage, RollingMean>();
  private readonly decode = new RollingMean();
  private readonly perTrack = new RollingMean();
  private readonly failures: FailureRecord[] = [];

  /** The stage a job is in, and when it entered it. */
  private readonly openStage = new Map<string, { stage: Stage; since: number }>();
  private tracksAnalysed = 0;

  constructor(private readonly now: () => number = () => Date.now()) {}

  /** Record a decode, in milliseconds. */
  noteDecode(durationMs: number): void {
    this.decode.add(durationMs);
  }

  /**
   * Record that a job has entered a stage.
   *
   * The previous stage is closed at the same moment, so a stage's time is measured
   * from its own start to the next one rather than guessed from a percentage.
   */
  noteStage(trackId: string, stage: Stage): void {
    const at = this.now();
    this.closeStage(trackId, at);
    this.openStage.set(trackId, { stage, since: at });
  }

  /** Record that a track finished, closing whatever stage it was in. */
  noteTrackDone(trackId: string, totalMs: number): void {
    this.closeStage(trackId, this.now());
    this.perTrack.add(totalMs);
    this.tracksAnalysed++;
  }

  /** Record a failure, and stop timing the job it belonged to. */
  noteFailure(trackId: string, code: WorkerErrorCode | 'decode', message: string): void {
    this.openStage.delete(trackId);
    this.failures.unshift({ trackId, code, message, at: this.now() });
    if (this.failures.length > MAX_FAILURES) this.failures.length = MAX_FAILURES;
  }

  snapshot(): DebugSnapshot {
    const stages = [...this.stages.entries()]
      .map(([stage, mean]) => ({ stage, meanMs: mean.mean, samples: mean.samples }))
      .sort((a, b) => b.meanMs - a.meanMs);

    return {
      stages,
      decodeMeanMs: this.decode.mean,
      trackMeanMs: this.perTrack.mean,
      tracksAnalysed: this.tracksAnalysed,
      failures: [...this.failures],
    };
  }

  private closeStage(trackId: string, at: number): void {
    const open = this.openStage.get(trackId);
    if (open === undefined) return;
    this.openStage.delete(trackId);

    const existing = this.stages.get(open.stage) ?? new RollingMean();
    existing.add(at - open.since);
    this.stages.set(open.stage, existing);
  }
}
