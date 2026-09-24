/**
 * Bringing the next track in on the beat.
 *
 * A cross-fade normally starts wherever the clock says, which means the incoming
 * track's first beat lands at a random point inside the outgoing track's bar. Two
 * pulses a fraction of a beat apart is the one mistake everybody hears, whether or
 * not they could name it: it does not sound like two records, it sounds like a
 * mistake.
 *
 * This is not beat-matching. Nothing is sped up or slowed down — the two records
 * play at their own tempos, as they were recorded. All that happens is that the
 * incoming track is started from a slightly different point in its own first
 * second, chosen so that its next beat falls exactly where the outgoing track's
 * next beat falls. At most one beat of the opening is skipped, and it is skipped
 * while that deck is still silent, so the seek is inaudible.
 *
 * What it cannot do is hold. Two records at different tempos drift apart at a rate
 * their difference sets, and nothing short of resampling one of them stops that —
 * so the alignment is exact at the moment of entry and decays from there. The
 * report says how long it lasts rather than pretending otherwise.
 *
 * Bars are deliberately not attempted. Knowing which of every four beats begins
 * the bar is a much harder measurement than knowing where the beats are, it is
 * wrong often enough on real music to matter, and being wrong about it is worse
 * than not asking: a fade deliberately started half a bar out is more obviously
 * wrong than one that simply does not know where the bar is.
 */

import type { Track } from '@vibeamp/core';

/** What a track has to carry before it can be aligned. */
export interface TrackGrid {
  /** Tempo in beats per minute. */
  bpm: number;
  /** When a beat falls, in seconds from the start of the track. */
  beatSec: number;
}

export interface BeatAlignment {
  /**
   * Seconds to skip from where the incoming track currently sits.
   *
   * Always between zero and one beat of the incoming track. Applied by seeking the
   * deck forward, which is silent because the deck is at the bottom of its fade.
   */
  skipSec: number;
  /** How far apart the two tempos are, as a share of the outgoing one. */
  drift: number;
  /**
   * How many beats the two grids stay together after the entry.
   *
   * `Infinity` when the tempos match exactly. Together means within a twentieth of
   * a beat, which is about the point at which two pulses stop being one.
   */
  holdsForBeats: number;
}

/** How far apart two beats may drift and still be heard as one. */
const TOGETHER = 1 / 20;

/**
 * A skip shorter than this is not worth a seek.
 *
 * A millisecond, which is far below what anyone hears, and which is also what
 * stops two grids that already agree from being nudged by a whole beat: the
 * difference between them arrives as a few parts in a quadrillion either side of
 * zero, and on the wrong side of zero a remainder is a full period.
 */
const NEGLIGIBLE_SEC = 0.001;

/**
 * The grid a track carries, or null when it has none worth acting on.
 *
 * @param end True for the grid at the end of the track, which is what a fade out
 *   of it lands on; false for the one at the start, which is what a fade into it
 *   begins with. They are measured separately: extrapolating one across a whole
 *   track is half a beat out by the last chorus.
 */
export function gridOf(track: Track, end: boolean): TrackGrid | null {
  const analysis = track.analysis;
  if (analysis === null || analysis.bpm <= 0) return null;
  const beatSec = end ? analysis.outroBeatSec : analysis.introBeatSec;
  if (beatSec === null) return null;
  return { bpm: analysis.bpm, beatSec };
}

/**
 * Where to start the incoming track so its next beat meets the outgoing one's.
 *
 * @param outgoing The grid at the end of the track now playing.
 * @param outgoingAtSec Where that track's playhead is, in its own timeline.
 * @param incoming The grid at the start of the track coming in.
 * @param incomingAtSec Where that track's playhead is. Normally near zero.
 * @returns Null when either track has no grid, which is most ambient music and
 *   anything the tempo estimator was not sure about. Nothing is moved in that
 *   case, and the fade happens where the clock says, as it always did.
 */
export function alignIncoming(
  outgoing: TrackGrid | null,
  outgoingAtSec: number,
  incoming: TrackGrid | null,
  incomingAtSec: number,
): BeatAlignment | null {
  if (outgoing === null || incoming === null) return null;
  if (!Number.isFinite(outgoingAtSec) || !Number.isFinite(incomingAtSec)) return null;

  const periodOut = 60 / outgoing.bpm;
  const periodIn = 60 / incoming.bpm;
  if (!(periodOut > 0) || !(periodIn > 0)) return null;

  const toOut = untilNextBeat(outgoing, outgoingAtSec, periodOut);
  const toIn = untilNextBeat(incoming, incomingAtSec, periodIn);

  // Move the incoming playhead forward until its next beat arrives at the same
  // moment as the outgoing one's. Forward only, and by less than one beat: there
  // is no going back before the start of a track, and the grid repeats anyway.
  const raw = modulo(toIn - toOut, periodIn);
  const skipSec = raw < NEGLIGIBLE_SEC || periodIn - raw < NEGLIGIBLE_SEC ? 0 : raw;

  const apart = Math.abs(periodIn - periodOut);
  return {
    skipSec,
    drift: Math.abs(incoming.bpm - outgoing.bpm) / outgoing.bpm,
    // The grids separate by the difference between the two periods on every beat.
    holdsForBeats: apart === 0 ? Infinity : (periodIn * TOGETHER) / apart,
  };
}

/**
 * Time from `at` to the next beat of a grid.
 *
 * Always more than zero, up to a whole period: a playhead sitting exactly on a beat
 * is a full period from the *next* one. Both sides are measured the same way, so
 * the convention cancels and only the difference between them matters.
 */
function untilNextBeat(grid: TrackGrid, at: number, period: number): number {
  const since = modulo(at - grid.beatSec, period);
  return period - since;
}

/** Remainder that is never negative, whatever the sign of the input. */
function modulo(value: number, period: number): number {
  return ((value % period) + period) % period;
}
