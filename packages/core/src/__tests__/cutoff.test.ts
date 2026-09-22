/**
 * What a cutoff means, and when it means nothing.
 *
 * The measurement itself lives in `@vibeamp/dsp`. This is the judgement built on
 * it, and the judgement is the part that is easy to get wrong: a 128 kbps file
 * that cuts off at 16 kHz is being exactly what it says it is, and calling that a
 * defect would flag most of the honest files in most collections.
 */

import { describe, expect, it } from 'vitest';
import { bitrateKbps, cutoffVerdict, describeCutoff } from '../cutoff.js';

describe('reading a cutoff', () => {
  it('calls a full spectrum full', () => {
    expect(cutoffVerdict({ trackId: 'a', cutoffHz: 21_000, kbps: 1411 })).toBe('full');
  });

  it('calls a high encode what it is, not a fault', () => {
    expect(cutoffVerdict({ trackId: 'a', cutoffHz: 19_500, kbps: 320 })).toBe('high');
  });

  it('leaves a small file with a small spectrum alone', () => {
    // The common honest case, and the one a naive check would flood the report
    // with: 128 kbps carrying 128 kbps worth of bandwidth.
    expect(cutoffVerdict({ trackId: 'a', cutoffHz: 16_000, kbps: 128 })).toBe('lossy');
  });

  it('names the disagreement between bytes and bandwidth', () => {
    // 320 kbps worth of file and 128 kbps worth of music: re-encoded from worse.
    expect(cutoffVerdict({ trackId: 'a', cutoffHz: 16_000, kbps: 320 })).toBe('transcode');
  });

  it('will not call a file transcoded without a bitrate to disagree with', () => {
    // A narrow file is not by itself a fault, and a guess here is a guess about
    // somebody's music collection.
    expect(cutoffVerdict({ trackId: 'a', cutoffHz: 16_000, kbps: null })).toBe('lossy');
  });

  it('has nothing to say when nothing was measured', () => {
    expect(cutoffVerdict({ trackId: 'a', cutoffHz: null, kbps: 320 })).toBeNull();
  });

  it('describes a reading with both numbers, or says there is none', () => {
    expect(describeCutoff({ trackId: 'a', cutoffHz: 16_000, kbps: 317.6 })).toBe(
      'cuts off at 16.0 kHz · 318k',
    );
    expect(describeCutoff({ trackId: 'a', cutoffHz: null, kbps: 320 })).toBe('no reading');
  });
});

describe('bitrate from the file itself', () => {
  it('reads it off the size and the length', () => {
    // Four megabytes over four minutes is about 133 kbps.
    expect(bitrateKbps(4_000_000, 240)).toBeCloseTo(133.3, 1);
  });

  it('has no answer without a length', () => {
    expect(bitrateKbps(4_000_000, null)).toBeNull();
    expect(bitrateKbps(4_000_000, 0)).toBeNull();
    expect(bitrateKbps(0, 240)).toBeNull();
  });
});
