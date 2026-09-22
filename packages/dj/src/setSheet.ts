/**
 * The plan, written down.
 *
 * The queue is twenty tracks deep and lives in memory, so the moment the tab
 * closes it is gone — including the part that took the work, which is the order.
 * This turns it into a file.
 *
 * It is one file rather than two. A playlist and a separate sheet of notes is a
 * pair that gets separated, and the M3U format already has somewhere to put the
 * notes: any `#` line that is not a directive is skipped by every player that
 * reads the format, so the same file plays in Winamp and reads as a set sheet in a
 * text editor. Nothing here invents a format.
 */

import { explainTransition } from './explain.js';
import type { Transition } from './explain.js';
import type { Track } from '@vibeamp/core';

export interface SetSheetRow {
  track: Track;
  /**
   * The move into this track.
   *
   * Null for the first row, which nothing leads into, and for any pair the
   * planner could not describe.
   */
  transition: Transition | null;
}

/**
 * Lay the plan out as rows, each carrying the move that leads into it.
 *
 * @param nowPlaying What is playing, which becomes the first row. Null when
 *   nothing is, in which case the set starts at the first planned track.
 * @param upcoming The plan, nearest first.
 */
export function setSheet(nowPlaying: Track | null, upcoming: readonly Track[]): SetSheetRow[] {
  const tracks = nowPlaying === null ? [...upcoming] : [nowPlaying, ...upcoming];
  return tracks.map((track, index) => {
    const previous = index === 0 ? null : tracks[index - 1];
    return {
      track,
      transition:
        previous === undefined || previous === null ? null : explainTransition(previous, track),
    };
  });
}
