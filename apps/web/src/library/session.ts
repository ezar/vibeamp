/**
 * The session file index.
 *
 * A track's record in the database knows its path but cannot open it: a
 * `FileSystemFileHandle` is only reachable by walking the folder again, and on
 * Firefox and Safari there is no handle at all. So the scan keeps the `File` objects
 * it already produced for as long as the page lives.
 *
 * This is why the app asks to connect a folder on start-up rather than restoring
 * silently. The index is per session; the analysis it feeds is permanent.
 */

import type { Track } from '@vibeamp/core';

export class SessionFiles {
  private readonly byId = new Map<string, File>();

  add(trackId: string, file: File): void {
    this.byId.set(trackId, file);
  }

  /** The file for a track, or `null` if this session has not seen it. */
  resolve(track: Track): File | null {
    return this.byId.get(track.id) ?? null;
  }

  get size(): number {
    return this.byId.size;
  }

  clear(): void {
    this.byId.clear();
  }
}
