/**
 * The IndexedDB schema, through Dexie.
 *
 * Audio is never stored. What lives here is folder handles, the descriptors, and
 * the play history: about two kilobytes a track, so twenty thousand tracks fit in
 * well under a hundred megabytes even with cover art.
 */

import Dexie from 'dexie';
import type { EntityTable } from 'dexie';
import type { LibraryStatistics, Root, Track } from '@vibeamp/core';

/**
 * A root folder.
 *
 * The handle survives a page reload but **the permission does not**, so the app
 * always starts by asking to reconnect rather than by reading files. Firefox and
 * Safari have no File System Access API at all and so store no handle; there the
 * folder is re-picked each session, and the cached analysis is still found because
 * the identity is the content hash.
 */
export interface StoredRoot extends Root {
  handle?: FileSystemDirectoryHandle;
}

export interface PlayEvent {
  id?: number;
  trackId: string;
  playedAt: number;
  /** Seconds actually listened to, so a skip is not counted as a play. */
  playedSec: number;
}

export interface SettingRecord {
  key: string;
  value: unknown;
}

/**
 * A Winamp skin the user brought.
 *
 * Skins are stored as the `.wsz` the user chose, never shipped with the app.
 * Classic skins are the work of their authors and redistributing them is not ours
 * to do; the shell can load any of them, so there is no reason to.
 */
export interface StoredSkin {
  id: string;
  /** Shown in the shell's own skin menu. Taken from the file name. */
  name: string;
  /** The `.wsz` itself, which is a zip. Dexie stores a Blob natively. */
  data: Blob;
  addedAt: number;
}

/** Keys used in the `settings` store. */
export const SETTING_KEYS = {
  statistics: 'library.statistics',
  vibeTarget: 'dj.vibeTarget',
  energyShape: 'dj.energyShape',
  crossfadeSec: 'audio.crossfadeSec',
  lastTrackId: 'player.lastTrackId',
  lastSkinId: 'skin.lastId',
} as const;

export class VibeampDatabase extends Dexie {
  roots!: EntityTable<StoredRoot, 'id'>;
  tracks!: EntityTable<Track, 'id'>;
  playHistory!: EntityTable<PlayEvent, 'id'>;
  settings!: EntityTable<SettingRecord, 'key'>;
  skins!: EntityTable<StoredSkin, 'id'>;

  constructor(name = 'vibeamp') {
    super(name);
    this.version(1).stores({
      roots: 'id',
      // The indexes are the ones the queue planner reads: it prefilters a large
      // library by tempo before scoring, and browsing is by artist and by folder.
      tracks: 'id, status, rootId, meta.artist, analysis.bpm, analysis.energy',
      playHistory: '++id, trackId, playedAt',
      settings: 'key',
    });

    // Version 2 adds the skins the user brings. Dexie carries every existing store
    // forward untouched, so an upgrade costs nobody their analysis.
    this.version(2).stores({
      skins: 'id, name, addedAt',
    });
  }
}

/** Read a setting, or `fallback` when it has never been written. */
export async function readSetting<T>(db: VibeampDatabase, key: string, fallback: T): Promise<T> {
  const record = await db.settings.get(key);
  return record === undefined ? fallback : (record.value as T);
}

/** Write a setting. */
export async function writeSetting(
  db: VibeampDatabase,
  key: string,
  value: unknown,
): Promise<void> {
  await db.settings.put({ key, value });
}

/** Read the library distribution used for normalisation. */
export async function readStatistics(
  db: VibeampDatabase,
  fallback: LibraryStatistics,
): Promise<LibraryStatistics> {
  return readSetting(db, SETTING_KEYS.statistics, fallback);
}
