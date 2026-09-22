/**
 * The background analysis loop.
 *
 * Reads pending tracks, decodes them one at a time on the main thread, hands the
 * samples to a free worker and writes the result. The order matters: it waits for a
 * worker **before** decoding, so there is never more than one large buffer per
 * worker in memory.
 *
 * It also stops when it should. A laptop analysing a library in a hidden tab on
 * battery is how this kind of feature earns a reputation for melting machines.
 */

import type { Track } from '@vibeamp/core';
import type { LibraryRepository } from '../library/repository.js';
import { UndecodableError, decodeMono } from './decode.js';
import type { AnalysisPool } from './pool.js';
import type { Stage } from '@vibeamp/analysis';
import type { DebugStats } from '../debug/stats.js';

/** Tracks fetched from the database per round. */
const BATCH_SIZE = 32;
/** Hidden for longer than this and the analysis stops until the tab is seen again. */
export const HIDDEN_PAUSE_MS = 5 * 60 * 1000;
/** Below this charge, on battery, the analysis stops. */
export const LOW_BATTERY = 0.2;

export interface RunnerProgress {
  analysed: number;
  remaining: number;
  currentTitle: string | null;
  stage: Stage | null;
  paused: boolean;
  pausedReason: string | null;
}

export interface RunnerOptions {
  repository: LibraryRepository;
  pool: AnalysisPool;
  /** Returns the file for a track, or `null` when it can no longer be reached. */
  resolveFile: (track: Track) => Promise<File | null>;
  onProgress?: (progress: RunnerProgress) => void;
  /** Where the timings and failures go, for the debug panel. */
  stats?: DebugStats;
  signal?: AbortSignal;
}

/** Minimal shape of the Battery Status API, which not every browser has. */
interface BatteryLike {
  level: number;
  charging: boolean;
}

export class AnalysisRunner {
  private running = false;
  private analysed = 0;
  private stage: Stage | null = null;
  private currentTitle: string | null = null;
  private hiddenSince: number | null = null;

  constructor(private readonly options: RunnerOptions) {
    this.options.signal?.addEventListener('abort', () => {
      this.running = false;
    });
  }

  /**
   * Work through the pending tracks until there are none, or until aborted.
   *
   * Safe to call again after it returns: it re-reads the queue from the database, so
   * a new folder picked halfway through is simply picked up.
   */
  async run(): Promise<void> {
    if (this.running) return;
    this.running = true;

    try {
      // Records whose file this session cannot reach. They stay pending in the
      // database, because the folder may be reconnected later, but they are skipped
      // for the rest of this run. Without this the loop re-fetches the same
      // unreachable records forever at full speed, and a batch of them also starves
      // every reachable track queued behind them.
      const unreachable = new Set<string>();

      while (this.running) {
        const reason = await this.pauseReason();
        if (reason !== null) {
          this.report(0, reason);
          await delay(5000);
          continue;
        }

        // Asking for the skipped ones too, so the query reaches past them to the
        // tracks that can still be analysed.
        const fetched = await this.options.repository.pendingTracks(BATCH_SIZE + unreachable.size);
        const batch = fetched.filter((track) => !unreachable.has(track.id));
        if (batch.length === 0) break;

        for (const track of batch) {
          if (!this.running) return;
          if ((await this.pauseReason()) !== null) break;
          if ((await this.analyseOne(track)) === 'unreachable') unreachable.add(track.id);
        }
      }

      // Percentiles written earlier were measured against a smaller library, so a
      // long run leaves its first tracks ranked against a fraction of the evidence
      // its last ones got. Re-ranking once at the end is one pass over the table and
      // never touches the audio again.
      if (this.analysed > 0) await this.options.repository.renormaliseAll();
    } finally {
      this.running = false;
      this.stage = null;
      this.currentTitle = null;
      this.report(0, null);
    }
  }

  stop(): void {
    this.running = false;
  }

  /**
   * Analyse one track.
   *
   * @returns `'unreachable'` when the file cannot be opened in this session, so the
   *   caller can stop offering it; `'attempted'` for everything else, including
   *   failures, because those change the track's status and leave the queue.
   */
  private async analyseOne(track: Track): Promise<'attempted' | 'unreachable'> {
    const { repository, pool, resolveFile, stats } = this.options;
    this.currentTitle = track.meta.title ?? track.fileName;
    const startedAt = Date.now();

    const file = await resolveFile(track);
    if (file === null) {
      // Not a failure of the file: the folder is simply not connected right now, so
      // the track keeps its pending status and waits for a session that can see it.
      return 'unreachable';
    }

    // Waiting for a worker before decoding is the back pressure. Reversing these two
    // lines is what fills the heap with 19 MB buffers and gets the tab killed.
    await pool.waitForSlot();
    if (!this.running) return 'attempted';

    await repository.setStatus(track.id, 'decoding');
    let decoded;
    const decodeStartedAt = Date.now();
    try {
      decoded = await decodeMono(file);
      stats?.noteDecode(Date.now() - decodeStartedAt);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      stats?.noteFailure(track.id, 'decode', message);
      await repository.recordFailure(track.id, message, !(error instanceof UndecodableError));
      return 'attempted';
    }

    await repository.setStatus(track.id, 'analyzing');
    const outcome = await pool.analyse({
      trackId: track.id,
      samples: decoded.samples,
      sampleRate: decoded.sampleRate,
      durationSec: decoded.durationSec,
      sideRatio: decoded.sideRatio,
      attempts: track.attempts,
    });

    if (outcome.features !== undefined) {
      await repository.saveAnalysis(track.id, outcome.features, decoded.durationSec);
      stats?.noteTrackDone(track.id, Date.now() - startedAt);
      this.analysed++;
    } else if (outcome.error !== undefined) {
      stats?.noteFailure(track.id, outcome.error.code, outcome.error.message);
      await repository.recordFailure(track.id, outcome.error.message, outcome.retryable);
    }

    const counts = await repository.counts();
    this.report(counts.pending + counts.failed, null);
    return 'attempted';
  }

  /** Why the analysis should not be running, or `null` if it should. */
  private async pauseReason(): Promise<string | null> {
    if (typeof document !== 'undefined' && document.hidden) {
      this.hiddenSince ??= Date.now();
      if (Date.now() - this.hiddenSince > HIDDEN_PAUSE_MS) {
        return 'paused while the tab is in the background';
      }
    } else {
      this.hiddenSince = null;
    }

    const battery = await readBattery();
    if (battery !== null && !battery.charging && battery.level < LOW_BATTERY) {
      return 'paused to save battery';
    }
    return null;
  }

  private report(remaining: number, pausedReason: string | null): void {
    this.options.onProgress?.({
      analysed: this.analysed,
      remaining,
      currentTitle: this.currentTitle,
      stage: this.stage,
      paused: pausedReason !== null,
      pausedReason,
    });
  }
}

/** The Battery Status API where it exists, and `null` where it does not. */
async function readBattery(): Promise<BatteryLike | null> {
  const withBattery = navigator as Navigator & { getBattery?: () => Promise<BatteryLike> };
  if (typeof withBattery.getBattery !== 'function') return null;
  try {
    return await withBattery.getBattery();
  } catch {
    return null;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
