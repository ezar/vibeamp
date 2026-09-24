/**
 * Two collections that never meet.
 *
 * The codec's job is to refuse anything it did not write, because a code decoded
 * by the wrong version produces two plausible histograms and a comparison that
 * means nothing. The comparison's job is to say only what two histograms can
 * support: where both libraries live, never which records either of them holds.
 */

import { describe, expect, it } from 'vitest';
import { commonGround, compareShapes } from '../compare.js';
import { SHAPE_CODE_LENGTH, decodeShapeCode, encodeShapeCode } from '../shapeCode.js';
import { libraryShape } from '../shape.js';
import { makeTrack } from './tracks.js';
import type { PitchClassName } from '../types.js';

/** A library of `count` tracks at one tempo and one key. */
function collection(
  count: number,
  bpm: number,
  root: PitchClassName,
  scale: 'major' | 'minor' = 'minor',
  prefix = 't',
): ReturnType<typeof makeTrack>[] {
  return Array.from({ length: count }, (_, index) =>
    makeTrack({ id: `${prefix}${index}`, bpm, root, scale }),
  );
}

describe('the code', () => {
  it('survives a round trip', () => {
    const shape = libraryShape([
      ...collection(6, 128, 'A'),
      ...collection(3, 96, 'C', 'major', 'u'),
    ]);
    const code = encodeShapeCode(shape);

    expect(code).toHaveLength(SHAPE_CODE_LENGTH);
    const read = decodeShapeCode(code);
    expect(read?.analysed).toBe(9);
    // Two thirds at 128 and a third at 96, as shares of the distribution.
    expect(read?.tempo[Math.floor((120 - 60) / 10)]).toBeCloseTo(2 / 3, 2);
    expect(read?.tempo[Math.floor((90 - 60) / 10)]).toBeCloseTo(1 / 3, 2);
  });

  it('is the same shape whatever the library is worth in tracks', () => {
    const small = decodeShapeCode(encodeShapeCode(libraryShape(collection(4, 128, 'A'))));
    const large = decodeShapeCode(encodeShapeCode(libraryShape(collection(400, 128, 'A'))));
    expect(small?.tempo).toEqual(large?.tempo);
    expect(small?.analysed).toBe(4);
    expect(large?.analysed).toBe(400);
  });

  it('carries nothing that could be turned back into a list of records', () => {
    const code = encodeShapeCode(
      libraryShape([makeTrack({ id: 'x', title: 'Debaser', artist: 'Pixies', bpm: 128 })]),
    );
    expect(code.toLowerCase()).not.toContain('debas');
    expect(code.toLowerCase()).not.toContain('pixie');
  });

  it('refuses a code it did not write', () => {
    const code = encodeShapeCode(libraryShape(collection(4, 128, 'A')));
    expect(decodeShapeCode('')).toBeNull();
    expect(decodeShapeCode(code.slice(0, -1))).toBeNull();
    expect(decodeShapeCode(`X2${code.slice(2)}`)).toBeNull();
    expect(decodeShapeCode(`${code.slice(0, -1)}!`)).toBeNull();
  });

  it('is unbothered by the whitespace a copied code picks up', () => {
    const code = encodeShapeCode(libraryShape(collection(4, 128, 'A')));
    expect(decodeShapeCode(`  ${code}\n`)).not.toBeNull();
  });
});

describe('comparing', () => {
  const mine = libraryShape([
    ...collection(10, 128, 'A'),
    ...collection(4, 124, 'E', 'minor', 'b'),
  ]);

  it('reports a library against itself as the same library', () => {
    const shared = decodeShapeCode(encodeShapeCode(mine));
    if (shared === null) throw new Error('its own code should decode');
    const report = compareShapes(mine, shared);

    expect(report.tempoOverlap).toBeCloseTo(1, 2);
    expect(report.keyOverlap).toBeCloseTo(1, 2);
    expect(report.theirsAlone.keys).toEqual([]);
    expect(report.yoursAlone.keys).toEqual([]);
  });

  it('finds no common ground between collections that share none', () => {
    const theirs = decodeShapeCode(
      encodeShapeCode(libraryShape(collection(10, 72, 'D', 'major', 'x'))),
    );
    if (theirs === null) throw new Error('a fresh code should decode');
    const report = compareShapes(mine, theirs);

    expect(report.tempoOverlap).toBeCloseTo(0, 2);
    expect(report.common.tempo).toEqual([]);
    expect(report.findings).toContain('There is no tempo you are both at home in.');
    // And nothing to play, which is an answer rather than a failure.
    expect(commonGround(collection(10, 128, 'A'), report)).toEqual([]);
  });

  it('names the stretch they live in and you do not', () => {
    const theirs = decodeShapeCode(
      encodeShapeCode(
        libraryShape([
          ...collection(5, 128, 'A', 'minor', 'y'),
          ...collection(5, 92, 'A', 'minor', 'z'),
        ]),
      ),
    );
    if (theirs === null) throw new Error('a fresh code should decode');
    const report = compareShapes(mine, theirs);

    expect(report.theirsAlone.tempo[0]).toMatchObject({ fromBpm: 90, toBpm: 100 });
    expect(report.findings.join(' ')).toContain('where you have next to nothing');
  });

  it('joins adjacent buckets into one stretch', () => {
    // Tempo is continuous. Reporting "120–130 and 130–140" as two findings would
    // be reporting the width of the bucket rather than the shape of the library.
    const wide = libraryShape([
      ...collection(5, 122, 'A'),
      ...collection(5, 132, 'A', 'minor', 'b'),
    ]);
    const theirs = decodeShapeCode(encodeShapeCode(wide));
    if (theirs === null) throw new Error('a fresh code should decode');
    const report = compareShapes(wide, theirs);

    expect(report.common.tempo).toHaveLength(1);
    expect(report.common.tempo[0]).toMatchObject({ fromBpm: 120, toBpm: 140 });
  });

  it('offers the middle of the shared ground when there is more than fits', () => {
    // The busiest shared band first. A library with three hundred candidates must
    // not hand back whichever twenty the table happened to return.
    const wide = libraryShape([
      ...collection(20, 128, 'A'),
      ...collection(3, 148, 'A', 'minor', 'edge'),
    ]);
    const theirs = decodeShapeCode(encodeShapeCode(wide));
    if (theirs === null) throw new Error('a fresh code should decode');
    const report = compareShapes(wide, theirs);

    // The thin band is listed first on the shelf, so an unranked cut would take it.
    const shelf = [...collection(3, 148, 'A', 'minor', 'edge'), ...collection(20, 128, 'A')];
    const chosen = commonGround(shelf, report, 4);
    expect(chosen.every((track) => (track.analysis?.bpm ?? 0) === 128)).toBe(true);
  });

  it('picks records of yours from the ground you share, in tempo order', () => {
    const theirs = decodeShapeCode(encodeShapeCode(mine));
    if (theirs === null) throw new Error('its own code should decode');
    const report = compareShapes(mine, theirs);

    const shelf = [
      ...collection(3, 128, 'A'),
      ...collection(2, 124, 'E', 'minor', 'b'),
      // Nowhere near the shared ground: right tempo would not save it, and it has
      // neither.
      ...collection(4, 72, 'D', 'major', 'far'),
    ];
    const chosen = commonGround(shelf, report);

    expect(chosen).toHaveLength(5);
    expect(chosen.every((track) => (track.analysis?.bpm ?? 0) >= 120)).toBe(true);
    const tempos = chosen.map((track) => track.analysis?.bpm ?? 0);
    expect([...tempos].sort((a, b) => a - b)).toEqual(tempos);
  });
});
