/**
 * The only writer to the database.
 *
 * Everything that changes a track goes through here, so there is one place that
 * knows how a `pending` track becomes a `done` one and how the library
 * distribution is kept up to date. The analysis workers never touch storage.
 */

import {
  ANALYSIS_VERSION,
  MIN_TRACKS_FOR_PERCENTILES,
  createLibraryStatistics,
  normaliseFeatures,
  recordFeatures,
  renormalise,
} from '@vibeamp/core';
import type { LibraryStatistics, RawFeatures, Track, TrackStatus } from '@vibeamp/core';
import { SETTING_KEYS, readStatistics, writeSetting } from './db.js';
import type { PlayEvent, VibeampDatabase } from './db.js';

/** How far back a play still counts as "recently played". */
export const RECENT_PLAY_WINDOW_MS = 4 * 60 * 60 * 1000;

/** A track as discovered by the scanner, before anything has been analysed. */
export interface DiscoveredTrack {
  id: string;
  rootId: string;
  relPath: string;
  fileName: string;
  size: number;
  lastModified: number;
}

export class LibraryRepository {
  constructor(private readonly db: VibeampDatabase) {}

  /**
   * Record what a scan found.
   *
   * A track already known is left alone apart from its path, which is how a renamed
   * file keeps its analysis. A track analysed by an older pipeline version is put
   * back to `pending`, which is what lets the descriptors improve without a rescan
   * and without discarding the metadata.
   *
   * @returns How many tracks are newly waiting to be analysed.
   */
  async recordDiscovered(discovered: readonly DiscoveredTrack[]): Promise<number> {
    if (discovered.length === 0) return 0;

    let queued = 0;
    await this.db.transaction('rw', this.db.tracks, async () => {
      const existing = await this.db.tracks.bulkGet(discovered.map((track) => track.id));
      const rows: Track[] = [];

      discovered.forEach((found, index) => {
        const previous = existing[index];
        if (previous === undefined) {
          rows.push(newTrack(found));
          queued++;
          return;
        }

        const stale = previous.analysisVersion < ANALYSIS_VERSION;
        rows.push({
          ...previous,
          // The path is the one thing a rescan is allowed to correct.
          rootId: found.rootId,
          relPath: found.relPath,
          fileName: found.fileName,
          status: stale ? 'pending' : previous.status,
          attempts: stale ? 0 : previous.attempts,
        });
        if (stale || previous.status === 'pending' || previous.status === 'failed') queued++;
      });

      await this.db.tracks.bulkPut(rows);
    });

    return queued;
  }

  /** Tracks waiting to be analysed, oldest first, at most `limit`. */
  async pendingTracks(limit: number): Promise<Track[]> {
    return this.db.tracks.where('status').anyOf('pending', 'failed').limit(limit).toArray();
  }

  /** How many tracks are in each state. */
  async counts(): Promise<Record<TrackStatus, number>> {
    const counts: Record<TrackStatus, number> = {
      pending: 0,
      decoding: 0,
      analyzing: 0,
      done: 0,
      failed: 0,
      unsupported: 0,
    };
    await this.db.tracks.each((track) => {
      counts[track.status]++;
    });
    return counts;
  }

  async setStatus(id: string, status: TrackStatus, errorMessage?: string): Promise<void> {
    await this.db.tracks.update(id, { status, errorMessage });
  }

  /** Record a failure and decide, from the attempt count, whether to retry it. */
  async recordFailure(id: string, message: string, retryable: boolean): Promise<void> {
    const track = await this.db.tracks.get(id);
    if (track === undefined) return;
    const attempts = track.attempts + 1;
    await this.db.tracks.update(id, {
      attempts,
      errorMessage: message,
      status: retryable ? 'failed' : 'unsupported',
    });
  }

  /**
   * Store a finished analysis.
   *
   * The raw descriptors are folded into the library distribution first, then
   * normalised against it, so a track's own values are part of the scale it is
   * measured on. Crossing {@link MIN_TRACKS_FOR_PERCENTILES} re-normalises
   * everything analysed so far, which costs one pass over the table and never
   * touches the audio again.
   */
  async saveAnalysis(id: string, raw: RawFeatures, durationSec: number): Promise<void> {
    const statistics = await readStatistics(this.db, createLibraryStatistics());
    const wasProvisional = statistics.loudness.total < MIN_TRACKS_FOR_PERCENTILES;
    recordFeatures(statistics, raw);

    await this.db.transaction('rw', this.db.tracks, this.db.settings, async () => {
      await this.db.tracks.update(id, {
        analysis: normaliseFeatures(raw, statistics),
        analysisVersion: ANALYSIS_VERSION,
        analyzedAt: Date.now(),
        durationSec,
        status: 'done',
        errorMessage: undefined,
      });
      await writeSetting(this.db, SETTING_KEYS.statistics, statistics);
    });

    const nowSettled = statistics.loudness.total >= MIN_TRACKS_FOR_PERCENTILES;
    if (wasProvisional && nowSettled) await this.renormaliseAll(statistics);
  }

  /**
   * Recompute every percentile against the current distribution.
   *
   * Exact, because each analysis stores the values its percentiles were computed
   * from. One pass over the table, and the audio is never touched again.
   */
  async renormaliseAll(statistics?: LibraryStatistics): Promise<void> {
    const stats = statistics ?? (await readStatistics(this.db, createLibraryStatistics()));

    await this.db.transaction('rw', this.db.tracks, async () => {
      const updates: Track[] = [];
      await this.db.tracks
        .where('status')
        .equals('done')
        .each((track) => {
          if (track.analysis === null) return;
          updates.push({ ...track, analysis: renormalise(track.analysis, stats) });
        });
      await this.db.tracks.bulkPut(updates);
    });
  }

  async allAnalysed(): Promise<Track[]> {
    return this.db.tracks.where('status').equals('done').toArray();
  }

  async get(id: string): Promise<Track | undefined> {
    return this.db.tracks.get(id);
  }

  // ---- play history ----

  async recordPlay(trackId: string, playedSec: number): Promise<void> {
    await this.db.playHistory.add({ trackId, playedAt: Date.now(), playedSec });
  }

  /**
   * Ids played within {@link RECENT_PLAY_WINDOW_MS}.
   *
   * The queue uses this to avoid repeating itself inside one listening session.
   */
  async recentlyPlayed(now = Date.now()): Promise<Set<string>> {
    const since = now - RECENT_PLAY_WINDOW_MS;
    const ids = new Set<string>();
    await this.db.playHistory
      .where('playedAt')
      .above(since)
      .each((event: PlayEvent) => ids.add(event.trackId));
    return ids;
  }

  /**
   * How often each track has been played, 0..1 against the most played.
   *
   * Drives the familiarity slider, which is the one descriptor that comes from
   * behaviour rather than from the audio.
   */
  async playFrequencies(): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    await this.db.playHistory.each((event: PlayEvent) => {
      counts.set(event.trackId, (counts.get(event.trackId) ?? 0) + 1);
    });

    let busiest = 0;
    for (const count of counts.values()) if (count > busiest) busiest = count;
    if (busiest === 0) return counts;

    const frequencies = new Map<string, number>();
    for (const [id, count] of counts) frequencies.set(id, count / busiest);
    return frequencies;
  }
}

function newTrack(found: DiscoveredTrack): Track {
  return {
    ...found,
    durationSec: null,
    meta: {
      title: null,
      artist: null,
      albumArtist: null,
      album: null,
      year: null,
      trackNo: null,
      genre: null,
      hasCoverArt: false,
    },
    analysis: null,
    analysisVersion: 0,
    analyzedAt: null,
    status: 'pending',
    attempts: 0,
  };
}
