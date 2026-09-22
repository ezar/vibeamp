/**
 * The plan, written down.
 *
 * What matters is that every row carries the move that leads *into* it, and that
 * the first row carries none: an off-by-one here writes a set sheet whose notes
 * describe the wrong transitions, which is worse than a sheet with no notes at all.
 */

import { describe, expect, it } from 'vitest';
import { setSheet } from '../setSheet.js';
import { makeTrack } from './tracks.js';

const A = makeTrack({ id: 'a', bpm: 120, root: 'C', scale: 'major' });
const B = makeTrack({ id: 'b', bpm: 124, root: 'G', scale: 'major' });
const C = makeTrack({ id: 'c', bpm: 128, root: 'A', scale: 'minor' });

describe('laying out a set', () => {
  it('puts what is playing first, with nothing leading into it', () => {
    const rows = setSheet(A, [B, C]);

    expect(rows.map((row) => row.track.id)).toEqual(['a', 'b', 'c']);
    expect(rows[0]!.transition).toBeNull();
  });

  it('gives every later row the move from the track above it', () => {
    const rows = setSheet(A, [B, C]);

    // Each transition is between its own row and the one before, not the one after.
    expect(rows[1]!.transition?.bpmFrom).toBe(120);
    expect(rows[1]!.transition?.bpmTo).toBe(124);
    expect(rows[2]!.transition?.bpmFrom).toBe(124);
    expect(rows[2]!.transition?.bpmTo).toBe(128);
  });

  it('starts at the first planned track when nothing is playing', () => {
    const rows = setSheet(null, [B, C]);

    expect(rows.map((row) => row.track.id)).toEqual(['b', 'c']);
    expect(rows[0]!.transition).toBeNull();
    expect(rows[1]!.transition).not.toBeNull();
  });

  it('is empty when there is no plan and nothing playing', () => {
    expect(setSheet(null, [])).toEqual([]);
  });

  it('is one row when something plays and nothing is planned', () => {
    const rows = setSheet(A, []);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.transition).toBeNull();
  });
});
