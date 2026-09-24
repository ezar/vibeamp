/**
 * The three ways bringing a track in on the beat comes to nothing.
 *
 * The arithmetic itself is `@vibeamp/dj`'s and is tested there. What is tested here
 * is the wiring: that a track without a grid is left exactly where it was, and that
 * nothing ever seeks past the end of a file — which would restart it at full volume
 * in the middle of a fade rather than nudge it by a fraction of a beat.
 */

import { describe, expect, it } from 'vitest';
import { alignedStart } from '../VibeampMedia.js';

const outgoing = { bpm: 120, beatSec: 180 };
const incoming = { bpm: 120, beatSec: 0.4 };

describe('where to start the incoming deck', () => {
  it('moves it forward by less than a beat', () => {
    const at = alignedStart({
      outgoing,
      outgoingAtSec: 180.13,
      incoming,
      incomingAtSec: 0.02,
      incomingDurationSec: 200,
    });
    expect(at).not.toBeNull();
    expect(at ?? 0).toBeGreaterThan(0.02);
    expect(at ?? 0).toBeLessThan(0.02 + 60 / 120);
  });

  it('leaves a track with no grid exactly where it was', () => {
    const common = { outgoingAtSec: 180.13, incomingAtSec: 0.02, incomingDurationSec: 200 };
    expect(alignedStart({ ...common, outgoing: null, incoming })).toBeNull();
    expect(alignedStart({ ...common, outgoing, incoming: null })).toBeNull();
  });

  it('refuses to seek past the end of a very short file', () => {
    // A one second sound effect in the playlist. Seeking past its end restarts it
    // from zero, which in the middle of a fade is a stutter rather than a beat.
    expect(
      alignedStart({
        outgoing,
        outgoingAtSec: 180.13,
        incoming,
        incomingAtSec: 0.9,
        incomingDurationSec: 1,
      }),
    ).toBeNull();
  });

  it('does nothing when the two next beats already fall together', () => {
    // Both a tenth of a second past a beat of their own grid, so both are four
    // tenths from the next one. There is nothing to move.
    expect(
      alignedStart({
        outgoing,
        outgoingAtSec: 180.1,
        incoming,
        incomingAtSec: 0.5,
        incomingDurationSec: 200,
      }),
    ).toBeNull();
  });
});
