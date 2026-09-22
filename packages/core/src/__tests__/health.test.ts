/**
 * What the health report says, and what it refuses to say.
 *
 * The thresholds themselves are measured through the real pipeline in
 * `packages/analysis/src/__tests__/health.test.ts`. This covers the reporting: that
 * a file which never analysed is a finding rather than an omission, that one defect
 * is never counted as two, and that the blind spots are stated.
 */

import { describe, expect, it } from 'vitest';
import { libraryHealth } from '../health.js';
import { toCamelot } from '../camelot.js';
import type { Track, TrackAnalysis, TrackStatus } from '../types.js';

interface Spec {
  id: string;
  status?: TrackStatus;
  analysisVersion?: number;
  analysed?: boolean;
  loudnessDb?: number;
  tailRatio?: number;
  clippedRatio?: number;
  sideRatio?: number | null;
}

function makeTrack(spec: Spec): Track {
  const analysis: TrackAnalysis = {
    bpm: 120,
    bpmConfidence: 0.9,
    key: {
      root: 'C',
      scale: 'major',
      strength: 0.8,
      margin: 0.3,
      camelot: toCamelot('C', 'major'),
    },
    loudnessDb: spec.loudnessDb ?? -14,
    energy: 0.5,
    brightness: 0.5,
    compression: 0.5,
    danceability: 0.5,
    provisional: false,
    inputs: { loudness: 0.2, brightness: 2000, compression: 5, danceability: 0.6 },
    fingerprint: null,
    tailRatio: spec.tailRatio ?? 0.05,
    clippedRatio: spec.clippedRatio ?? 0,
    sideRatio: spec.sideRatio === undefined ? 0.3 : spec.sideRatio,
    windows: [],
  };

  const analysed = spec.analysed ?? true;
  return {
    id: spec.id,
    rootId: 'root',
    relPath: `${spec.id}.mp3`,
    fileName: `${spec.id}.mp3`,
    size: 1000,
    lastModified: 0,
    durationSec: 200,
    meta: {
      title: spec.id,
      artist: null,
      albumArtist: null,
      album: null,
      year: null,
      trackNo: null,
      genre: null,
      hasCoverArt: false,
    },
    analysis: analysed ? analysis : null,
    analysisVersion: spec.analysisVersion ?? 3,
    analyzedAt: analysed ? 1 : null,
    status: spec.status ?? (analysed ? 'done' : 'pending'),
    attempts: 0,
  };
}

/** The tracks a given finding named, by id. */
function found(health: ReturnType<typeof libraryHealth>, issue: string): string[] {
  return health.findings.find((one) => one.issue === issue)?.tracks.map((t) => t.id) ?? [];
}

describe('finding defects', () => {
  it('says nothing about a healthy library', () => {
    const health = libraryHealth([makeTrack({ id: 'a' }), makeTrack({ id: 'b' })]);
    expect(health.findings).toEqual([]);
    expect(health.affected).toBe(0);
    expect(health.checked).toBe(2);
  });

  it('counts a file that never analysed as a finding, not an omission', () => {
    // The easy mistake is to check only what analysed, which reports a library of
    // undecodable files as perfectly healthy.
    const health = libraryHealth([
      makeTrack({ id: 'good' }),
      makeTrack({ id: 'wma', analysed: false, status: 'unsupported' }),
      makeTrack({ id: 'broken', analysed: false, status: 'failed' }),
    ]);

    expect(found(health, 'undecodable')).toEqual(['wma']);
    expect(found(health, 'failed')).toEqual(['broken']);
    expect(health.total).toBe(3);
    expect(health.checked).toBe(1);
    expect(health.affected).toBe(2);
  });

  it('finds a file with nothing in it', () => {
    const health = libraryHealth([
      makeTrack({ id: 'music', loudnessDb: -14 }),
      makeTrack({ id: 'quiet', loudnessDb: -38 }),
      makeTrack({ id: 'empty', loudnessDb: -78 }),
    ]);
    // A quiet recording is not a defect. An empty file is.
    expect(found(health, 'silent')).toEqual(['empty']);
  });

  it('finds mono in a stereo container, and leaves an honest mono file alone', () => {
    const health = libraryHealth([
      makeTrack({ id: 'stereo', sideRatio: 0.3 }),
      makeTrack({ id: 'narrow', sideRatio: 0.02 }),
      makeTrack({ id: 'fake', sideRatio: 0 }),
      makeTrack({ id: 'mono', sideRatio: null }),
    ]);
    expect(found(health, 'fake-stereo')).toEqual(['fake']);
  });

  it('finds a file that ends at full level, worst first', () => {
    const health = libraryHealth([
      makeTrack({ id: 'fade', tailRatio: 0.04 }),
      makeTrack({ id: 'cut', tailRatio: 0.78 }),
      makeTrack({ id: 'worse', tailRatio: 0.95 }),
    ]);
    expect(found(health, 'abrupt-end')).toEqual(['worse', 'cut']);
  });

  it('reports a silent file once and measures nothing else on it', () => {
    // Two channels of silence are identical, silence ends as loudly as it began,
    // and none of it clips. Left alone, one broken file appears as four findings.
    const health = libraryHealth([
      makeTrack({ id: 'empty', loudnessDb: -78, tailRatio: 0.99, sideRatio: 0, clippedRatio: 0.4 }),
    ]);
    expect(found(health, 'silent')).toEqual(['empty']);
    expect(found(health, 'abrupt-end')).toEqual([]);
    expect(found(health, 'fake-stereo')).toEqual([]);
    expect(found(health, 'clipped')).toEqual([]);
    expect(health.findings).toHaveLength(1);
    expect(health.affected).toBe(1);
  });

  it('finds clipping, worst first, and ignores loud', () => {
    const health = libraryHealth([
      makeTrack({ id: 'loud', clippedRatio: 0 }),
      makeTrack({ id: 'clipped', clippedRatio: 0.0099 }),
      makeTrack({ id: 'destroyed', clippedRatio: 0.09 }),
    ]);
    expect(found(health, 'clipped')).toEqual(['destroyed', 'clipped']);
  });

  it('counts a file with two defects once', () => {
    const health = libraryHealth([makeTrack({ id: 'bad', sideRatio: 0, clippedRatio: 0.05 })]);
    expect(health.findings).toHaveLength(2);
    expect(health.affected).toBe(1);
  });
});

describe('descriptors from before these checks existed', () => {
  it('counts them as unchecked rather than as clean', () => {
    // The repository keeps a stale track's old descriptors until the re-analysis
    // reaches it, so the fields these checks read are simply absent. Reading them
    // as zeros would report a library nobody has looked at as a healthy one.
    const health = libraryHealth([
      makeTrack({ id: 'current' }),
      makeTrack({ id: 'stale', analysisVersion: 2 }),
      makeTrack({ id: 'older', analysisVersion: 1 }),
    ]);

    expect(health.checked).toBe(1);
    expect(health.awaitingReanalysis).toBe(2);
    expect(health.findings).toEqual([]);
  });

  it('does not report a stale track as a defect either', () => {
    // The other half of the same mistake: a missing measurement is not a finding.
    const health = libraryHealth([
      makeTrack({ id: 'stale', analysisVersion: 2, sideRatio: 0, clippedRatio: 0.5 }),
    ]);
    expect(health.findings).toEqual([]);
    expect(health.affected).toBe(0);
  });
});

describe('what it admits it cannot see', () => {
  it('always says the ordinary analysis cannot see a transcode, and where to look', () => {
    // A report that stayed quiet about it would make its silence mean "no
    // transcodes". It points at the second decode rather than calling the check
    // impossible, because a line saying "cannot be seen" is false the moment
    // somebody runs that.
    const health = libraryHealth([makeTrack({ id: 'a' })]);
    const line = health.blindSpots.find((one) => one.includes('16 kHz'));
    expect(line).toBeDefined();
    expect(line).toContain('deep check');
  });

  it('says clipping is a lower bound only when it found some', () => {
    expect(
      libraryHealth([makeTrack({ id: 'a' })]).blindSpots.some((line) => line.includes('blunts')),
    ).toBe(false);
    expect(
      libraryHealth([makeTrack({ id: 'a', clippedRatio: 0.05 })]).blindSpots.some((line) =>
        line.includes('blunts'),
      ),
    ).toBe(true);
  });

  it('mentions mono files only when there are some', () => {
    expect(
      libraryHealth([makeTrack({ id: 'a' })]).blindSpots.some((line) =>
        line.includes('already one channel'),
      ),
    ).toBe(false);
    expect(
      libraryHealth([makeTrack({ id: 'a', sideRatio: null })]).blindSpots.some((line) =>
        line.includes('already one channel'),
      ),
    ).toBe(true);
  });

  it('warns that a one-channel fault can hide, only where there is stereo', () => {
    // Every measure but the stereo one is taken after the downmix, so a defect in
    // one channel is averaged against a clean one and can vanish.
    expect(
      libraryHealth([makeTrack({ id: 'a', sideRatio: null })]).blindSpots.some((line) =>
        line.includes('mixed down'),
      ),
    ).toBe(false);
    expect(
      libraryHealth([makeTrack({ id: 'a', sideRatio: 0.3 })]).blindSpots.some((line) =>
        line.includes('mixed down'),
      ),
    ).toBe(true);
  });
});
