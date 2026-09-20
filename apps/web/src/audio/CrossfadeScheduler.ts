/**
 * Making the cross-fade apply to ordinary advance.
 *
 * The problem it solves: the shell asks for the next track only after the current
 * one emits `ended`, and an ended element reports itself paused — so by the time
 * the audio engine is handed the next URL there is nothing left to fade out of.
 * The two-deck path only ever ran on a manual skip, and the four second default did
 * nothing for ordinary playback.
 *
 * The fix is to advance *early* rather than to preload. A cross-fade length before
 * the end, this asks the shell to move to the next track. The shell advances for
 * real, so its playlist position, its time display and its highlighted row all stay
 * in step — which preloading inside the audio engine would have broken — and the
 * existing fade fires unchanged, because there genuinely is still audio playing
 * when the load arrives.
 *
 * The outgoing track is not truncated: it keeps playing on its own deck through the
 * fade and reaches its real end as the fade completes.
 */

/** What the scheduler needs from the audio engine. */
export interface CrossfadeSource {
  on(event: string, callback: (...args: unknown[]) => void): () => void;
  timeElapsed(): number;
  duration(): number;
  currentUrl(): string | null;
  getCrossfadeSeconds(): number;
}

/**
 * How many cross-fade lengths a track must last before it is faded at all.
 *
 * Fading four seconds out of a ten second track is most of the track. Below this
 * the tracks simply follow one another.
 */
export const MIN_TRACK_MULTIPLE = 3;

export interface CrossfadeSchedulerOptions {
  media: CrossfadeSource;
  /** Moves the shell to the next track. */
  advance: () => void;
  /** Whether there is a next track to move to. */
  hasNext: () => boolean;
}

export class CrossfadeScheduler {
  /** The track this has already advanced out of, so it fires once per track. */
  private firedFor: string | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor(private readonly options: CrossfadeSchedulerOptions) {}

  /** Start watching playback. */
  start(): void {
    if (this.unsubscribe !== null) return;
    this.unsubscribe = this.options.media.on('timeupdate', () => this.check());
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  /**
   * Decide whether it is time to move on.
   *
   * Exposed so the tests can drive it directly rather than through an event.
   */
  check(): void {
    const { media, advance, hasNext } = this.options;

    const fade = media.getCrossfadeSeconds();
    if (fade <= 0) return;

    const url = media.currentUrl();
    if (url === null || url === this.firedFor) return;

    const duration = media.duration();
    const elapsed = media.timeElapsed();
    // A stream, or a track whose metadata has not arrived, has no end to aim at.
    if (!Number.isFinite(duration) || duration <= 0) return;
    if (!Number.isFinite(elapsed) || elapsed < 0) return;
    if (duration < fade * MIN_TRACK_MULTIPLE) return;

    if (duration - elapsed > fade) return;
    // Advancing with nothing to advance into would stop playback early rather than
    // fade into anything.
    if (!hasNext()) return;

    this.firedFor = url;
    advance();
  }
}
