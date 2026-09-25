/**
 * The bridge between vibeamp's tracks and Webamp's playlist.
 *
 * Tracks are handed to the shell as URL tracks over object URLs that **this class
 * creates**, rather than as blob tracks. That is the only way to know later which
 * of our tracks the shell is playing: Webamp reports a track change by URL, and if
 * it made the URL itself there is nothing to map it back to. An object URL is
 * same-origin, so there is no CORS to satisfy and nothing leaves the device.
 *
 * Owning the URLs also means owning when they are revoked, which is why the audio
 * engine no longer does it.
 */

import type Webamp from 'webamp';
import type { Track as WebampTrack } from 'webamp';
import { gridOf } from '@vibeamp/dj';
import type { TrackGrid } from '@vibeamp/dj';
import { runsInto, segueSideOf, trimDb } from '@vibeamp/core';
import type { SegueSide, Track } from '@vibeamp/core';

export interface QueuedEntry {
  track: Track;
  file: File;
}

/** Everything the audio engine needs to know about what is at a URL. */
export interface UrlPlayback {
  /** Where the beats fall as the track begins, for a fade into it. */
  intro: TrackGrid | null;
  /** Where they fall as it ends, for a fade out of it. */
  outro: TrackGrid | null;
  /** How much to move this track's level, in decibels. See `levelling.ts`. */
  trimDb: number;
  /** When the music starts, in seconds, or null when nothing was measured. */
  soundStartSec: number | null;
  /** When it stops, in seconds from the start of the file. */
  soundEndSec: number | null;
  /** What the join test needs from this track. See `segue.ts`. */
  segue: SegueSide | null;
}

export class PlaylistBridge {
  private readonly trackIdByUrl = new Map<string, string>();
  private readonly urlByTrackId = new Map<string, string>();
  /**
   * What each URL needs at playback time, kept beside the URLs.
   *
   * The audio engine works in URLs and knows nothing about tracks, and neither a
   * fade nor a level can wait for a database read: both are happening now. So the
   * few numbers it needs are recorded here, where a track and its URL meet, and
   * looked up synchronously.
   */
  private readonly playbackByUrl = new Map<string, UrlPlayback>();
  /**
   * The level the library is levelled to, in dBFS, or null while it is too small
   * to have a middle. Set by the app; see `levelling.ts`.
   */
  private loudnessReferenceDb: number | null = null;

  constructor(private readonly webamp: Webamp) {}

  /**
   * Turn tracks into shell tracks and record their URLs, without queueing them.
   *
   * What "Load list" needs: Webamp replaces its own playlist with whatever the
   * handler returns, so the tracks have to be registered here first or the shell
   * plays URLs this bridge cannot map back to anything.
   */
  register(entries: readonly QueuedEntry[]): WebampTrack[] {
    return entries.map((entry) => this.toWebampTrack(entry));
  }

  /** Our track id for each entry of the shell's playlist, in order. */
  trackIdsFor(urls: readonly string[]): Array<string | null> {
    return urls.map((url) => this.trackIdByUrl.get(url) ?? null);
  }

  /** Add tracks to the end of the shell's playlist. */
  append(entries: readonly QueuedEntry[]): void {
    if (entries.length === 0) return;
    this.webamp.appendTracks(entries.map((entry) => this.toWebampTrack(entry)));
  }

  /** Replace the whole playlist and start playing the first track. */
  replaceAll(entries: readonly QueuedEntry[]): void {
    if (entries.length === 0) return;
    this.webamp.setTracksToPlay(entries.map((entry) => this.toWebampTrack(entry)));
  }

  /** What to do with the track at a URL when it plays. */
  playbackForUrl(url: string | null): UrlPlayback | null {
    if (url === null) return null;
    return this.playbackByUrl.get(url) ?? null;
  }

  /**
   * Set the level the library is levelled to.
   *
   * Recorded rather than applied: the trims are computed as tracks are queued, so
   * a reference that arrives after a track was queued reaches it the next time it
   * is. That is the right trade — re-deriving the whole playlist to move one file
   * by half a decibel is not worth a pass over it.
   */
  setLoudnessReference(referenceDb: number | null): void {
    this.loudnessReferenceDb = referenceDb;
  }

  /**
   * The URL the shell will play after this one, or null when there is none.
   *
   * The cross-fade scheduler needs it to ask whether the next track runs straight
   * out of this one, which is a question about the pair and not about either track.
   */
  nextUrlAfter(url: string | null): string | null {
    const playlist = this.webamp.getPlaylistTracks();
    const index = url === null ? -1 : playlist.findIndex((entry) => entry.url === url);
    if (index === -1) return null;
    return playlist[index + 1]?.url ?? null;
  }

  /** Does the track at `url` run straight into the one the shell plays next? */
  segueFollows(url: string | null): boolean {
    const next = this.nextUrlAfter(url);
    if (next === null) return false;
    return runsInto(
      this.playbackForUrl(url)?.segue ?? null,
      this.playbackForUrl(next)?.segue ?? null,
    );
  }

  /** Our track id for a URL the shell reported, or `null` if we did not queue it. */
  trackIdForUrl(url: string | null): string | null {
    if (url === null) return null;
    return this.trackIdByUrl.get(url) ?? null;
  }

  /** Every track id currently in the shell's playlist, in order. */
  queuedTrackIds(): string[] {
    return this.webamp
      .getPlaylistTracks()
      .map((entry) => this.trackIdByUrl.get(entry.url))
      .filter((id): id is string => id !== undefined);
  }

  /** How many tracks sit after the one at `url`. */
  remainingAfter(url: string | null): number {
    const playlist = this.webamp.getPlaylistTracks();
    if (url === null) return playlist.length;
    const index = playlist.findIndex((entry) => entry.url === url);
    return index === -1 ? playlist.length : playlist.length - index - 1;
  }

  /** Release every URL. Called when the app shuts down. */
  dispose(): void {
    for (const url of this.trackIdByUrl.keys()) URL.revokeObjectURL(url);
    this.trackIdByUrl.clear();
    this.urlByTrackId.clear();
    this.playbackByUrl.clear();
  }

  private toWebampTrack({ track, file }: QueuedEntry): WebampTrack {
    // One URL per track, reused: queueing the same track twice must not leak, and
    // must not break the mapping by giving it two identities.
    let url = this.urlByTrackId.get(track.id);
    if (url === undefined) {
      url = URL.createObjectURL(file);
      this.urlByTrackId.set(track.id, url);
      this.trackIdByUrl.set(url, track.id);
    }
    // Refreshed on every pass, not only when the URL is new: a track re-queued
    // after its analysis finished has grids and a level this time.
    this.playbackByUrl.set(url, {
      intro: gridOf(track, false),
      outro: gridOf(track, true),
      trimDb: trimDb(track, this.loudnessReferenceDb),
      soundStartSec: track.analysis?.soundStartSec ?? null,
      soundEndSec: track.analysis?.soundEndSec ?? null,
      segue: segueSideOf(track),
    });

    return {
      url,
      metaData: {
        title: track.meta.title ?? track.fileName,
        artist: track.meta.artist ?? '',
      },
      ...(track.durationSec !== null ? { duration: track.durationSec } : {}),
    };
  }
}
