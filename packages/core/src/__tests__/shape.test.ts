/**
 * What the X-ray counts, and what it refuses to count.
 *
 * The refusals matter as much as the counts. A histogram that included every
 * tempo the estimator returned — including the ones it returned because it had to
 * return something — would draw a peak that belongs to the estimator rather than
 * to the music, and the whole point of this feature is that the numbers are the
 * library's own.
 */

import { describe, expect, it } from 'vitest';
import { TEMPO_MAX_BPM, TEMPO_MIN_BPM, libraryShape } from '../shape.js';
import { toCamelot } from '../camelot.js';
import type { KeyScale, PitchClassName, Track, TrackAnalysis } from '../types.js';

interface Spec {
  id: string;
  bpm?: number;
  bpmConfidence?: number;
  root?: PitchClassName;
  scale?: KeyScale;
  keyStrength?: number;
  year?: number | null;
  durationSec?: number | null;
  analysed?: boolean;
}

function makeTrack(spec: Spec): Track {
  const root = spec.root ?? 'C';
  const scale = spec.scale ?? 'major';
  const analysis: TrackAnalysis = {
    bpm: spec.bpm ?? 120,
    bpmConfidence: spec.bpmConfidence ?? 0.9,
    key: {
      root,
      scale,
      strength: spec.keyStrength ?? 0.8,
      margin: 0.3,
      camelot: toCamelot(root, scale),
    },
    loudnessDb: -10,
    energy: 0.5,
    brightness: 0.5,
    compression: 0.5,
    danceability: 0.5,
    provisional: false,
    inputs: { loudness: 0.2, brightness: 2000, compression: 5, danceability: 0.6 },
    fingerprint: null,
    windows: [],
  };

  return {
    id: spec.id,
    rootId: 'root',
    relPath: `${spec.id}.mp3`,
    fileName: `${spec.id}.mp3`,
    size: 1000,
    lastModified: 0,
    durationSec: spec.durationSec === undefined ? 200 : spec.durationSec,
    meta: {
      title: spec.id,
      artist: null,
      albumArtist: null,
      album: null,
      year: spec.year ?? null,
      trackNo: null,
      genre: null,
      hasCoverArt: false,
    },
    analysis: (spec.analysed ?? true) ? analysis : null,
    analysisVersion: 2,
    analyzedAt: 1,
    status: (spec.analysed ?? true) ? 'done' : 'pending',
    attempts: 0,
  };
}

/** The count in the bucket a tempo falls in. */
function countAt(shape: ReturnType<typeof libraryShape>, bpm: number): number {
  return shape.tempo.find((bucket) => bpm >= bucket.fromBpm && bpm < bucket.toBpm)?.count ?? -1;
}

describe('counting', () => {
  it('separates what was analysed from what is merely there', () => {
    const shape = libraryShape([
      makeTrack({ id: 'a' }),
      makeTrack({ id: 'b' }),
      makeTrack({ id: 'c', analysed: false }),
    ]);

    expect(shape.total).toBe(3);
    expect(shape.analysed).toBe(2);
    // The unanalysed track contributes no time, no tempo and no key.
    expect(shape.playingTimeSec).toBe(400);
    expect(shape.tempo.reduce((sum, bucket) => sum + bucket.count, 0)).toBe(2);
  });

  it('keeps the full tempo axis whatever the library occupies', () => {
    const shape = libraryShape([makeTrack({ id: 'a', bpm: 128 })]);

    expect(shape.tempo[0]?.fromBpm).toBe(TEMPO_MIN_BPM);
    expect(shape.tempo.at(-1)?.toBpm).toBe(TEMPO_MAX_BPM);
    expect(countAt(shape, 128)).toBe(1);
    expect(countAt(shape, 70)).toBe(0);
  });

  it('leaves out a tempo the estimator was not sure of', () => {
    // An estimator with no pulse to find returns a number anyway. Counting those
    // puts a peak wherever the estimator's own preferences lie.
    const shape = libraryShape([
      makeTrack({ id: 'sure', bpm: 128 }),
      makeTrack({ id: 'guess', bpm: 128, bpmConfidence: 0.1 }),
      makeTrack({ id: 'none', bpm: 0, bpmConfidence: 0 }),
    ]);

    expect(countAt(shape, 128)).toBe(1);
  });

  it('leaves out a tempo off the ends of the chart', () => {
    const shape = libraryShape([
      makeTrack({ id: 'slow', bpm: 20 }),
      makeTrack({ id: 'fast', bpm: 400 }),
    ]);
    expect(shape.tempo.every((bucket) => bucket.count === 0)).toBe(true);
  });

  it('offers all 24 positions of the wheel, occupied or not', () => {
    const shape = libraryShape([
      makeTrack({ id: 'a', root: 'A', scale: 'minor' }),
      makeTrack({ id: 'b', root: 'A', scale: 'minor' }),
      makeTrack({ id: 'c', root: 'C', scale: 'major' }),
    ]);

    expect(shape.keys).toHaveLength(24);
    // A minor and C major share the number and differ in the letter, which is the
    // relation the wheel exists to show.
    expect(shape.keys.find((slice) => slice.camelot === '8A')?.count).toBe(2);
    expect(shape.keys.find((slice) => slice.camelot === '8B')?.count).toBe(1);
    expect(shape.keys.filter((slice) => slice.count === 0)).toHaveLength(22);
  });

  it('leaves out a key the estimator was not sure of', () => {
    const shape = libraryShape([
      makeTrack({ id: 'sure', root: 'A', scale: 'minor' }),
      makeTrack({ id: 'guess', root: 'A', scale: 'minor', keyStrength: 0.2 }),
    ]);
    expect(shape.keys.find((slice) => slice.camelot === '8A')?.count).toBe(1);
  });

  it('groups by decade, and says nothing when there are no years', () => {
    expect(libraryShape([makeTrack({ id: 'a' })]).decades).toEqual([]);

    const shape = libraryShape([
      makeTrack({ id: 'a', year: 1994 }),
      makeTrack({ id: 'b', year: 1999 }),
      makeTrack({ id: 'c', year: 2003 }),
      makeTrack({ id: 'd', year: 12 }),
    ]);
    expect(shape.decades).toEqual([
      { decade: 1990, count: 2 },
      { decade: 2000, count: 1 },
    ]);
  });
});

describe('what it says about the counts', () => {
  it('finds the narrowest band holding half the library', () => {
    // Forty tracks clustered at 120-140 and ten spread far from it. The band is
    // the cluster, not the single busiest bucket and not the whole range.
    const tracks = [
      ...Array.from({ length: 20 }, (_, i) => makeTrack({ id: `slow-${i}`, bpm: 122 })),
      ...Array.from({ length: 20 }, (_, i) => makeTrack({ id: `fast-${i}`, bpm: 134 })),
      ...Array.from({ length: 10 }, (_, i) => makeTrack({ id: `odd-${i}`, bpm: 70 + i })),
    ];

    const finding = libraryShape(tracks).findings.find((line) => line.includes('BPM'));
    expect(finding).toContain('120 and 140');
  });

  it('names the busiest key and how much of the wheel is used', () => {
    const tracks = [
      ...Array.from({ length: 6 }, (_, i) =>
        makeTrack({ id: `a-${i}`, root: 'A', scale: 'minor' }),
      ),
      makeTrack({ id: 'c', root: 'C', scale: 'major' }),
      makeTrack({ id: 'g', root: 'G', scale: 'major' }),
    ];

    const finding = libraryShape(tracks).findings.find((line) => line.includes('most common key'));
    expect(finding).toContain('8A');
    expect(finding).toContain('75%');
    expect(finding).toContain('3 of the');
  });

  it('reports the holes in the wheel only while they are worth naming', () => {
    // Twenty-two empty positions is not a finding, it is a small library.
    const small = libraryShape([makeTrack({ id: 'a', root: 'A', scale: 'minor' })]);
    expect(small.findings.some((line) => line.startsWith('Nothing at all'))).toBe(false);
  });

  it('says nothing at all about an empty library', () => {
    const shape = libraryShape([]);
    expect(shape.findings).toEqual([]);
    expect(shape.analysed).toBe(0);
    expect(shape.keys.every((slice) => slice.count === 0)).toBe(true);
  });

  it('counts time in hours once there is more than an hour of it', () => {
    const shape = libraryShape([makeTrack({ id: 'a', durationSec: 3 * 3600 + 25 * 60 })]);
    expect(shape.findings[0]).toContain('3h 25m');
  });

  it.each([
    [20, 'Under a minute'],
    [62, '1 minute of music'],
    [200, '3 minutes'],
    [3600, '1 hour of music'],
    [7200, '2 hours'],
  ])('reads %i seconds as %s', (durationSec, expected) => {
    const shape = libraryShape([makeTrack({ id: 'a', durationSec })]);
    expect(shape.findings[0]).toContain(expected);
  });

  it('survives a track with no duration', () => {
    const shape = libraryShape([makeTrack({ id: 'a', durationSec: null })]);
    expect(shape.playingTimeSec).toBe(0);
    expect(shape.findings.some((line) => line.includes('of music'))).toBe(false);
  });
});
