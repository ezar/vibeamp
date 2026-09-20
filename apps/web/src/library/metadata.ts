/**
 * Reading tags.
 *
 * Separate from the descriptors on purpose. Tags are what the file claims about
 * itself; the descriptors are what the audio actually sounds like. The player shows
 * the first and queues on the second, and a track with no tags at all is still fully
 * usable.
 */

import { parseBlob } from 'music-metadata';
import type { TrackMeta } from '@vibeamp/core';

/** Empty tags, for a file that has none or whose tags cannot be read. */
export function emptyMeta(): TrackMeta {
  return {
    title: null,
    artist: null,
    albumArtist: null,
    album: null,
    year: null,
    trackNo: null,
    genre: null,
    hasCoverArt: false,
  };
}

/**
 * Read the tags from a file.
 *
 * Never throws. A malformed tag is common in a real library, and it must not stop a
 * track being playable or analysable.
 */
export async function readMeta(file: Blob): Promise<TrackMeta> {
  try {
    const { common } = await parseBlob(file, { duration: false });
    return {
      title: common.title ?? null,
      artist: common.artist ?? null,
      albumArtist: common.albumartist ?? null,
      album: common.album ?? null,
      year: common.year ?? null,
      trackNo: common.track.no ?? null,
      genre: common.genre ?? null,
      hasCoverArt: (common.picture?.length ?? 0) > 0,
    };
  } catch {
    return emptyMeta();
  }
}
