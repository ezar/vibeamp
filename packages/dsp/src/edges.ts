/**
 * Where a track actually starts and stops.
 *
 * A file's length and a recording's length are not the same thing, and every
 * collection is full of the difference: a rip that kept four seconds of lead-in, a
 * download padded with an encoder's silence, an album track with the run-out left
 * on, a "hidden track" with two minutes of nothing before it. A player that treats
 * the file's ends as the music's ends leaves a hole in the middle of a set every
 * time one of those comes up.
 *
 * What this measures is dead air and nothing else. The floor is relative to the
 * track's own level rather than absolute, so it means the same thing for a quiet
 * recording as for a loud one, and it sits far enough below the music that a
 * genuinely quiet intro is never mistaken for silence. A fade-out is not trimmed: a
 * fade is the end of the music, and cutting it would be editing somebody's record.
 */

/**
 * How far below the track's own mean level counts as silence, in decibels.
 *
 * Forty. Music does not go forty decibels under its own average and stay there —
 * that is a hundredth of the amplitude — while digital black, dither noise and an
 * encoder's padding are all far below it. Being relative is what makes it work on
 * a quiet recording and on a brickwalled one alike.
 */
export const EDGE_FLOOR_DB = -40;

/**
 * How long sound must persist before it counts as the start, in seconds.
 *
 * A fifth of a second. Shorter than any note anybody plays deliberately, long
 * enough that a click, a tape pop or a single spike of noise in the lead-in is not
 * mistaken for the beginning of the music.
 */
export const EDGE_MIN_RUN_SEC = 0.2;

/** Level is measured over frames this long, in seconds. */
const FRAME_SEC = 0.05;

export interface SoundEdges {
  /** When the music starts, in seconds from the start of the file. */
  startSec: number;
  /** When it stops, in seconds from the start of the file. */
  endSec: number;
}

/**
 * Find the first and last moment there is music.
 *
 * @returns Null for a file with nothing in it above the floor — which is a file of
 *   silence, and a question for the condition report rather than for this.
 */
export function soundEdges(samples: Float32Array, sampleRate: number): SoundEdges | null {
  if (samples.length === 0 || !Number.isFinite(sampleRate) || sampleRate <= 0) return null;

  const frameSize = Math.max(1, Math.round(FRAME_SEC * sampleRate));
  const frames = Math.floor(samples.length / frameSize);
  if (frames < 1) return null;

  const levels = new Float64Array(frames);
  let total = 0;
  for (let frame = 0; frame < frames; frame += 1) {
    let sum = 0;
    const from = frame * frameSize;
    for (let i = from; i < from + frameSize; i += 1) {
      const value = samples[i] ?? 0;
      sum += value * value;
    }
    const level = Math.sqrt(sum / frameSize);
    levels[frame] = level;
    total += level;
  }

  const mean = total / frames;
  if (!(mean > 0)) return null;
  const floor = mean * 10 ** (EDGE_FLOOR_DB / 20);

  const run = Math.max(1, Math.round(EDGE_MIN_RUN_SEC / FRAME_SEC));
  const loud = (frame: number): boolean => (levels[frame] ?? 0) > floor;

  const start = firstSustained(frames, run, loud, 1);
  if (start === null) return null;
  const end = firstSustained(frames, run, loud, -1);
  if (end === null) return null;

  return {
    startSec: (start * frameSize) / sampleRate,
    // The end of the frame, not its start: the music lasts through it.
    endSec: ((end + 1) * frameSize) / sampleRate,
  };
}

/**
 * The first frame from one end whose neighbourhood is mostly above the floor.
 *
 * Mostly, rather than entirely: music has gaps in it, and a rest between two notes
 * is not the end of the track. Half the window is the rule, which is also what
 * stops one click in the lead-in from counting as the start — a single loud frame
 * cannot carry a window on its own.
 *
 * @param direction 1 to search forwards from the beginning, -1 backwards from the
 *   end.
 * @returns The frame index, or null when no window anywhere qualifies.
 */
function firstSustained(
  frames: number,
  run: number,
  loud: (frame: number) => boolean,
  direction: 1 | -1,
): number | null {
  const from = direction === 1 ? 0 : frames - 1;
  const to = direction === 1 ? frames : -1;

  for (let frame = from; frame !== to; frame += direction) {
    if (!loud(frame)) continue;

    let above = 0;
    let counted = 0;
    for (let step = 0; step < run; step += 1) {
      const at = frame + step * direction;
      if (at < 0 || at >= frames) break;
      counted += 1;
      if (loud(at)) above += 1;
    }
    if (counted > 0 && above * 2 >= counted) return frame;
  }
  return null;
}
