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
  /**
   * When the music on the current track stops, in seconds, or null when nothing
   * was measured. See `edges.ts`.
   */
  soundEndSeconds(): number | null;
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
  /**
   * Whether the current track runs straight into the next one. See `segue.ts`.
   *
   * A join is not faded: the shell is moved on right at the end of the music
   * instead, and the two decks overlap only by the splice the audio engine uses to
   * cover an element's start-up. Fading a join by four seconds would destroy it,
   * and the ordinary gap between two files would destroy it differently.
   */
  segueAhead?: () => boolean;
}

/**
 * How early the shell is moved on where one track runs into the next, in seconds.
 *
 * Three tenths. It has to cover the audio engine's own splice and the moment an
 * element takes to start, and no more than that: every tenth of a second here is a
 * tenth of a second of the outgoing track that plays under the incoming one.
 */
export const SEGUE_LEAD_SEC = 0.3;

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
    const { media, advance, hasNext, segueAhead } = this.options;

    const url = media.currentUrl();
    if (url === null || url === this.firedFor) return;

    // A join is honoured whatever the fade is set to, including off: the point of
    // it is that the music does not stop, and left alone the shell would put a gap
    // there.
    const joined = segueAhead?.() === true;
    const fade = joined ? SEGUE_LEAD_SEC : media.getCrossfadeSeconds();
    if (fade <= 0) return;

    const duration = media.duration();
    const elapsed = media.timeElapsed();
    // A stream, or a track whose metadata has not arrived, has no end to aim at.
    if (!Number.isFinite(duration) || duration <= 0) return;
    if (!Number.isFinite(elapsed) || elapsed < 0) return;

    // The end of the music, not the end of the file. A rip that kept four seconds
    // of run-out would otherwise put four seconds of silence in the middle of a
    // set, which is exactly what a cross-fade is for avoiding.
    const end = endOfMusic(duration, media.soundEndSeconds());
    // The short-track rule is about fading a track away, not about a join: a
    // fifteen second interlude that runs into the next track still has to.
    if (!joined && end < fade * MIN_TRACK_MULTIPLE) return;

    if (end - elapsed > fade) return;
    // Advancing with nothing to advance into would stop playback early rather than
    // fade into anything.
    if (!hasNext()) return;

    this.firedFor = url;
    advance();
  }
}

/**
 * Where a track effectively ends.
 *
 * The measurement when there is one and it is usable; the file's length otherwise.
 * A measurement past the end of the file, or at zero, is ignored rather than
 * trusted — the first would do nothing and the second would end every track
 * immediately.
 */
function endOfMusic(durationSec: number, soundEndSec: number | null): number {
  if (soundEndSec === null || !Number.isFinite(soundEndSec)) return durationSec;
  if (soundEndSec <= 0 || soundEndSec > durationSec) return durationSec;
  return soundEndSec;
}
