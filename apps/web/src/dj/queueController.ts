/**
 * Keeping the queue ahead of the music.
 *
 * Webamp has no public way to rewrite the tail of its playlist: `appendTracks` adds
 * and `setTracksToPlay` replaces everything and restarts playback, which would
 * interrupt the track that is on. So the plan lives here, and only a couple of
 * tracks at a time are pushed into the shell.
 *
 * That is what makes "move a slider and the queue reorders" true without touching
 * what is playing. Re-planning rewrites this list, which is entirely ours, and the
 * change reaches the listener after the one or two tracks already handed over. See
 * `docs/decisions/0004-the-plan-lives-outside-the-shell.md`.
 */

import type { EnergyShape, Track, VibeTarget } from '@vibeamp/core';
import type { AutoDj } from './autoDj.js';
import type { PlaylistBridge, QueuedEntry } from '../webamp/playlist.js';
import type { LibraryRepository } from '../library/repository.js';

/**
 * How many planned tracks are handed to the shell at a time.
 *
 * Two, not twenty. One is needed so the cross-fade has something to fade into; more
 * than that is queue the user would have to listen through before a slider move
 * became audible.
 */
export const SHELL_LOOKAHEAD = 2;

/** How long a plan is kept before it is topped up again. */
export const PLAN_LENGTH = 20;

export interface QueueSettings {
  target: VibeTarget;
  shape: EnergyShape;
  enabled: boolean;
}

export class QueueController {
  /** The plan, ours alone. The shell only ever sees its first entries. */
  private plan: QueuedEntry[] = [];
  private currentTrackId: string | null = null;

  constructor(
    private readonly autoDj: AutoDj,
    private readonly bridge: PlaylistBridge,
    private readonly repository: LibraryRepository,
    private readonly settings: () => QueueSettings,
  ) {}

  /** The track the shell is playing, as far as this controller knows. */
  get playingTrackId(): string | null {
    return this.currentTrackId;
  }

  /**
   * Called when the shell moves to a new track.
   *
   * Records the play, then tops the shell up so there is always something queued.
   */
  async onTrackChanged(url: string | null): Promise<void> {
    const trackId = this.bridge.trackIdForUrl(url);
    if (trackId !== null && trackId !== this.currentTrackId) {
      this.currentTrackId = trackId;
      // Recorded on change rather than on completion: a skip is still a signal about
      // what the listener does not want right now.
      await this.repository.recordPlay(trackId, 0);
    }
    await this.topUp(url);
  }

  /**
   * Rebuild the plan from the playing track.
   *
   * Never touches what is playing, and never removes what the shell already holds.
   * Anything already handed over plays out first; everything after it is new.
   */
  async replan(): Promise<void> {
    await this.buildPlan(this.bridge.queuedTrackIds());
  }

  /**
   * Plan the next stretch.
   *
   * @param exclude Tracks not to pick, normally what the shell already holds so the
   *   queue does not repeat itself.
   */
  private async buildPlan(exclude: readonly string[]): Promise<void> {
    const settings = this.settings();
    if (!settings.enabled) {
      this.plan = [];
      return;
    }

    const seed = await this.seed();
    if (seed === null) {
      this.plan = [];
      return;
    }

    this.plan = (
      await this.autoDj.plan({
        seed,
        target: settings.target,
        shape: settings.shape,
        alreadyQueued: exclude,
        length: PLAN_LENGTH,
      })
    ).map((entry) => ({ track: entry.planned.track, file: entry.file }));
  }

  /** Push planned tracks into the shell until it holds {@link SHELL_LOOKAHEAD}. */
  async topUp(currentUrl: string | null): Promise<void> {
    if (!this.settings().enabled) return;

    const needed = SHELL_LOOKAHEAD - this.bridge.remainingAfter(currentUrl);
    if (needed <= 0) return;

    if (this.plan.length < needed) await this.replan();
    const handing = this.plan.splice(0, needed);
    if (handing.length > 0) this.bridge.append(handing);
  }

  /**
   * Take the playlist over and start a planned session.
   *
   * Switching the auto-DJ on **replaces** the playlist. Until then the shell holds
   * whatever the scan put there, which for a freshly connected folder is the whole
   * library, and Webamp offers no way to trim a playlist's tail — so a planned
   * queue appended to it would not be heard for hours.
   *
   * Two consequences, both deliberate. The planning here must not exclude what the
   * shell currently holds: on a first scan that is every candidate there is, and
   * excluding them plans nothing and the takeover never happens. And replacing the
   * playlist restarts playback from the first planned track, because
   * `setTracksToPlay` is the only way to replace it. That is a direct answer to the
   * user pressing a button, not something a slider does: re-planning afterwards
   * still never touches what is playing.
   */
  async start(): Promise<boolean> {
    await this.buildPlan([]);
    if (this.plan.length === 0) return false;

    this.bridge.replaceAll(this.plan.splice(0, SHELL_LOOKAHEAD));
    return true;
  }

  /** The seed to plan from: what is playing, or any analysed track to begin with. */
  private async seed(): Promise<Track | null> {
    if (this.currentTrackId !== null) {
      const playing = await this.repository.get(this.currentTrackId);
      if (playing?.analysis != null) return playing;
    }
    const analysed = await this.repository.allAnalysed();
    return analysed[0] ?? null;
  }
}
