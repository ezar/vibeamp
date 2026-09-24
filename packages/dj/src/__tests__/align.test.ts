/**
 * Bringing the next record in on the beat.
 *
 * The arithmetic is short and every one of these tests is about a case where
 * getting it wrong is audible. A quarter of a beat out is not a subtle flaw: two
 * pulses that close sound like a mistake rather than like two records.
 */

import { describe, expect, it } from 'vitest';
import { alignIncoming, gridOf } from '../align.js';
import type { TrackGrid } from '../align.js';

/** Where the incoming grid sits once the skip has been applied, relative to the outgoing beat. */
function metAt(
  outgoing: TrackGrid,
  outgoingAt: number,
  incoming: TrackGrid,
  incomingAt: number,
): number {
  const alignment = alignIncoming(outgoing, outgoingAt, incoming, incomingAt);
  if (alignment === null) throw new Error('expected an alignment');

  const periodOut = 60 / outgoing.bpm;
  const periodIn = 60 / incoming.bpm;
  const nextOut =
    periodOut - ((((outgoingAt - outgoing.beatSec) % periodOut) + periodOut) % periodOut);
  const start = incomingAt + alignment.skipSec;
  const nextIn = periodIn - ((((start - incoming.beatSec) % periodIn) + periodIn) % periodIn);
  // Both measured from the same instant, so a difference of zero is two beats
  // landing together.
  return Math.abs(nextIn - nextOut);
}

describe('meeting on a beat', () => {
  it('puts the two next beats on the same instant', () => {
    const outgoing = { bpm: 128, beatSec: 181.31 };
    const incoming = { bpm: 128, beatSec: 0.42 };
    for (const at of [180.0, 180.17, 180.44, 181.09]) {
      expect(metAt(outgoing, at, incoming, 0.05)).toBeLessThan(1e-9);
    }
  });

  it('never skips more than one beat of the opening', () => {
    const incoming = { bpm: 174, beatSec: 0.2 };
    for (const at of [100, 100.1, 100.23, 100.37, 100.49]) {
      const alignment = alignIncoming({ bpm: 120, beatSec: 60 }, at, incoming, 0);
      expect(alignment?.skipSec).toBeGreaterThanOrEqual(0);
      expect(alignment?.skipSec).toBeLessThan(60 / 174);
    }
  });

  it('meets on a beat across an octave of tempo', () => {
    // 70 into 140 is the same pulse counted twice. The arithmetic needs no special
    // case for it, and this is the test that says so.
    expect(
      metAt({ bpm: 70, beatSec: 200.1 }, 240.3, { bpm: 140, beatSec: 0.3 }, 0.02),
    ).toBeLessThan(1e-9);
  });

  it('says how long the alignment lasts, because it does not last', () => {
    // Nothing is resampled, so two different tempos drift apart from the instant
    // they meet. Saying so is the difference between a feature and a claim.
    const same = alignIncoming({ bpm: 128, beatSec: 0 }, 100, { bpm: 128, beatSec: 0 }, 0);
    expect(same?.holdsForBeats).toBe(Infinity);
    expect(same?.drift).toBe(0);

    const close = alignIncoming({ bpm: 128, beatSec: 0 }, 100, { bpm: 129, beatSec: 0 }, 0);
    expect(close?.drift).toBeCloseTo(1 / 128, 4);
    // About six beats at a BPM apart, which is most of a short fade.
    expect(close?.holdsForBeats ?? 0).toBeGreaterThan(5);

    const far = alignIncoming({ bpm: 100, beatSec: 0 }, 100, { bpm: 128, beatSec: 0 }, 0);
    expect(far?.holdsForBeats ?? 99).toBeLessThan(1);
  });

  it('does not throw away a beat when the two grids already agree', () => {
    // The difference between two grids that agree arrives as a few parts in a
    // quadrillion either side of zero, and on the wrong side of zero a remainder
    // is a whole period — which would skip a beat of the opening for nothing.
    const alignment = alignIncoming(
      { bpm: 120, beatSec: 180 },
      180.1,
      { bpm: 120, beatSec: 0.4 },
      0.5,
    );
    expect(alignment?.skipSec).toBe(0);
  });

  it('does nothing at all when either track has no grid', () => {
    const grid = { bpm: 128, beatSec: 1 };
    expect(alignIncoming(null, 10, grid, 0)).toBeNull();
    expect(alignIncoming(grid, 10, null, 0)).toBeNull();
    expect(alignIncoming(grid, Number.NaN, grid, 0)).toBeNull();
  });
});

describe('reading a grid off a track', () => {
  const analysis = {
    bpm: 128,
    introBeatSec: 0.4,
    outroBeatSec: 181.2,
  };
  const track = { analysis } as unknown as Parameters<typeof gridOf>[0];

  it('takes each end from its own measurement', () => {
    expect(gridOf(track, false)).toEqual({ bpm: 128, beatSec: 0.4 });
    expect(gridOf(track, true)).toEqual({ bpm: 128, beatSec: 181.2 });
  });

  it('has nothing to say about a track analysed before grids existed', () => {
    const old = { analysis: { bpm: 128, introBeatSec: null, outroBeatSec: null } };
    expect(gridOf(old as unknown as Parameters<typeof gridOf>[0], false)).toBeNull();
    expect(gridOf({ analysis: null } as unknown as Parameters<typeof gridOf>[0], true)).toBeNull();
  });
});
