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
import type { Track } from '@vibeamp/core';

export interface QueuedEntry {
  track: Track;
  file: File;
}

/** The two grids a track carries, ready for the audio engine. */
export interface UrlGrids {
  /** Where the beats fall as the track begins, for a fade into it. */
  intro: TrackGrid | null;
  /** Where they fall as it ends, for a fade out of it. */
  outro: TrackGrid | null;
}

export class PlaylistBridge {
  private readonly trackIdByUrl = new Map<string, string>();
  private readonly urlByTrackId = new Map<string, string>();
  /**
   * The beat grids, kept beside the URLs.
   *
   * The audio engine works in URLs and knows nothing about tracks, and a fade
   * cannot wait for a database read: it is happening now. So the two numbers it
   * needs are recorded here, where a track and its URL meet, and looked up
   * synchronously.
   */
  private readonly gridsByUrl = new Map<string, UrlGrids>();

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

  /** The beat grids for a URL, or null for a track that has none. */
  gridsForUrl(url: string | null): UrlGrids | null {
    if (url === null) return null;
    return this.gridsByUrl.get(url) ?? null;
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
    this.gridsByUrl.clear();
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
    // after its analysis finished has grids this time.
    this.gridsByUrl.set(url, { intro: gridOf(track, false), outro: gridOf(track, true) });

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
