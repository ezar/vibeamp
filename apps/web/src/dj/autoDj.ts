/**
 * Wiring the planner to the shell.
 *
 * The planner is a pure function in `@vibeamp/dj`. This is the part that knows where
 * the tracks come from, what has been played, and how to get a queue into Webamp's
 * playlist.
 *
 * One rule governs it: **the playing track is never touched.** Re-planning appends
 * from the next position onwards, so moving a slider reorders what is coming without
 * interrupting what is on.
 */

import { canAutoDj, planQueue } from '@vibeamp/dj';
import type { PlannedTrack, QueueContext } from '@vibeamp/dj';
import type { EnergyShape, Track, VibeTarget } from '@vibeamp/core';
import type { LibraryRepository } from '../library/repository.js';

/** How many tracks to keep queued ahead of the one playing. */
export const QUEUE_LOOKAHEAD = 20;
/** How many recent artists and albums count against a candidate. */
const RECENT_MEMORY = 10;

export interface AutoDjOptions {
  repository: LibraryRepository;
  /** Resolves a track to something playable, or `null` if unreachable. */
  resolveFile: (track: Track) => Promise<File | null>;
}

export interface PlanRequest {
  seed: Track;
  target: VibeTarget;
  shape: EnergyShape;
  /** Tracks already queued ahead, which must not be repeated. */
  alreadyQueued?: readonly string[];
  length?: number;
}

export class AutoDj {
  constructor(private readonly options: AutoDjOptions) {}

  /** Whether there is enough analysed material for a queue to be worth building. */
  async isReady(): Promise<boolean> {
    return canAutoDj(await this.options.repository.allAnalysed());
  }

  /**
   * Plan the next stretch of the queue.
   *
   * Returns the planned tracks paired with their files, so the caller can hand them
   * straight to the shell. A track whose file cannot be reached is dropped rather
   * than queued to fail later.
   */
  async plan(request: PlanRequest): Promise<Array<{ planned: PlannedTrack; file: File }>> {
    const { repository, resolveFile } = this.options;
    const candidates = await repository.allAnalysed();
    if (!canAutoDj(candidates)) return [];

    const planned = planQueue({
      seed: request.seed,
      candidates,
      target: request.target,
      shape: request.shape,
      context: await this.buildContext(request.seed, candidates),
      length: request.length ?? QUEUE_LOOKAHEAD,
      exclude: request.alreadyQueued ?? [],
    });

    const resolved: Array<{ planned: PlannedTrack; file: File }> = [];
    for (const entry of planned) {
      const file = await resolveFile(entry.track);
      if (file !== null) resolved.push({ planned: entry, file });
    }
    return resolved;
  }

  /**
   * Assemble the repetition context.
   *
   * The recent artists and albums come from the play history rather than from the
   * queue, so restarting the app does not make the last hour's listening feel new
   * again.
   */
  private async buildContext(seed: Track, candidates: readonly Track[]): Promise<QueueContext> {
    const [recentIds, frequencies] = await Promise.all([
      this.options.repository.recentlyPlayed(),
      this.options.repository.playFrequencies(),
    ]);

    const byId = new Map(candidates.map((track) => [track.id, track]));
    const recentArtists: string[] = [];
    const recentAlbums: string[] = [];

    // The seed counts as recent: whatever is playing now should not be immediately
    // followed by more of the same artist.
    for (const track of [seed, ...[...recentIds].map((id) => byId.get(id))]) {
      if (track === undefined) continue;
      if (track.meta.artist !== null && recentArtists.length < RECENT_MEMORY) {
        recentArtists.push(track.meta.artist);
      }
      if (track.meta.album !== null && recentAlbums.length < RECENT_MEMORY) {
        recentAlbums.push(track.meta.album);
      }
    }

    return {
      recentArtists,
      recentAlbums,
      playedRecently: (trackId) => recentIds.has(trackId),
      playFrequency: (trackId) => frequencies.get(trackId) ?? 0,
    };
  }
}
