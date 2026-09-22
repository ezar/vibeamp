/**
 * Export and import, against fake-indexeddb.
 *
 * A backup that silently loses descriptors, or an import that doubles every play
 * count, is the kind of bug nobody notices until the data it damaged is the only
 * copy left.
 */

import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { ANALYSIS_VERSION } from '@vibeamp/core';
import type { RawFeatures } from '@vibeamp/core';
import { VibeampDatabase } from '../db.js';
import { LibraryRepository } from '../repository.js';
import type { DiscoveredTrack } from '../repository.js';
import {
  EXPORT_FORMAT,
  EXPORT_VERSION,
  ImportError,
  exportLibrary,
  importLibrary,
  parseExport,
  shouldReplace,
} from '../exchange.js';
import type { LibraryExport } from '../exchange.js';

function discovered(id: string, overrides: Partial<DiscoveredTrack> = {}): DiscoveredTrack {
  return {
    id,
    rootId: 'root-1',
    relPath: `music/${id}.mp3`,
    fileName: `${id}.mp3`,
    size: 5_000_000,
    lastModified: 1000,
    ...overrides,
  };
}

function features(overrides: Partial<RawFeatures> = {}): RawFeatures {
  return {
    bpm: 124,
    bpmConfidence: 0.9,
    keyRoot: 'A',
    keyScale: 'minor',
    keyStrength: 0.8,
    keyMargin: 0.3,
    loudnessDb: -9,
    rmsMean: 0.2,
    crestFactor: 4,
    centroidHzMean: 2200,
    fluxMean: 12,
    zcrMean: 0.08,
    danceabilityRaw: 0.7,
    fingerprint: null,
    tailRatio: 0.05,
    clippedRatio: 0,
    sideRatio: 0.4,
    windows: [{ startSec: 10, rms: 0.2, centroidHz: 2200, flux: 12, zcr: 0.08, lowBandRatio: 0.3 }],
    ...overrides,
  };
}

let db: VibeampDatabase;
let repository: LibraryRepository;
let counter = 0;

async function freshLibrary(): Promise<{ db: VibeampDatabase; repository: LibraryRepository }> {
  const database = new VibeampDatabase(`vibeamp-exchange-${counter++}`);
  await database.open();
  return { db: database, repository: new LibraryRepository(database) };
}

beforeEach(async () => {
  ({ db, repository } = await freshLibrary());
});

describe('exportLibrary', () => {
  it('carries every track and its descriptors', async () => {
    await repository.recordDiscovered([discovered('a'), discovered('b')]);
    await repository.saveAnalysis('a', features(), 210);

    const exported = await exportLibrary(db);
    expect(exported.format).toBe(EXPORT_FORMAT);
    expect(exported.version).toBe(EXPORT_VERSION);
    expect(exported.analysisVersion).toBe(ANALYSIS_VERSION);
    expect(exported.tracks).toHaveLength(2);

    const analysed = exported.tracks.find((track) => track.id === 'a');
    expect(analysed?.analysis?.bpm).toBe(124);
    expect(analysed?.analysis?.key.camelot).toBe('8A');
    // The inputs have to travel, or the importing library cannot re-rank anything.
    expect(analysed?.analysis?.inputs.loudness).toBeCloseTo(0.2, 6);
  });

  it('drops the local play history ids, which mean nothing elsewhere', async () => {
    await repository.recordDiscovered([discovered('a')]);
    await repository.recordPlay('a', 120);

    const exported = await exportLibrary(db);
    expect(exported.playHistory).toHaveLength(1);
    expect(exported.playHistory[0]).not.toHaveProperty('id');
    expect(exported.playHistory[0]?.trackId).toBe('a');
  });

  it('survives a round trip through JSON', async () => {
    await repository.recordDiscovered([discovered('a')]);
    await repository.saveAnalysis('a', features(), 210);

    const exported = await exportLibrary(db);
    const reparsed = parseExport(JSON.stringify(exported));
    expect(reparsed.tracks).toEqual(exported.tracks);
  });
});

describe('parseExport', () => {
  it('refuses something that is not JSON', () => {
    expect(() => parseExport('not json at all')).toThrow(ImportError);
    expect(() => parseExport('not json at all')).toThrow(/not JSON/);
  });

  it('refuses JSON that is not an export', () => {
    for (const text of ['null', '[]', '{"hello":"world"}', '"a string"']) {
      expect(() => parseExport(text)).toThrow(/not a vibeamp export/);
    }
  });

  it('refuses a version it cannot read, and says which', () => {
    const text = JSON.stringify({ format: EXPORT_FORMAT, version: 99, tracks: [] });
    expect(() => parseExport(text)).toThrow(/version 99/);
  });

  it('refuses an export with no tracks array', () => {
    const text = JSON.stringify({ format: EXPORT_FORMAT, version: EXPORT_VERSION });
    expect(() => parseExport(text)).toThrow(/no tracks/);
  });

  it('tolerates a missing play history', () => {
    const text = JSON.stringify({ format: EXPORT_FORMAT, version: EXPORT_VERSION, tracks: [] });
    expect(parseExport(text).playHistory).toEqual([]);
  });
});

describe('shouldReplace', () => {
  it('takes an analysis over none', async () => {
    await repository.recordDiscovered([discovered('a')]);
    const bare = (await repository.get('a')) as NonNullable<
      Awaited<ReturnType<typeof repository.get>>
    >;
    await repository.saveAnalysis('a', features(), 210);
    const analysed = (await repository.get('a')) as typeof bare;

    expect(shouldReplace(bare, analysed)).toBe(true);
    expect(shouldReplace(analysed, bare)).toBe(false);
  });

  it('takes a newer pipeline over an older one', async () => {
    await repository.recordDiscovered([discovered('a')]);
    await repository.saveAnalysis('a', features(), 210);
    const current = (await repository.get('a')) as NonNullable<
      Awaited<ReturnType<typeof repository.get>>
    >;
    const newer = { ...current, analysisVersion: current.analysisVersion + 1 };

    expect(shouldReplace(current, newer)).toBe(true);
    expect(shouldReplace(newer, current)).toBe(false);
  });

  it('leaves an equally good record alone', async () => {
    await repository.recordDiscovered([discovered('a')]);
    await repository.saveAnalysis('a', features(), 210);
    const current = (await repository.get('a')) as NonNullable<
      Awaited<ReturnType<typeof repository.get>>
    >;
    expect(shouldReplace(current, { ...current })).toBe(false);
  });
});

describe('importLibrary', () => {
  it('moves a library to an empty browser without re-analysing anything', async () => {
    for (let i = 0; i < 60; i++) {
      await repository.recordDiscovered([discovered(`t${i}`)]);
      await repository.saveAnalysis(`t${i}`, features({ rmsMean: i / 300 }), 200);
    }
    const exported = await exportLibrary(db);

    const target = await freshLibrary();
    const summary = await importLibrary(target.db, target.repository, exported);

    expect(summary.added).toBe(60);
    expect(summary.improved).toBe(0);
    expect(await target.repository.allAnalysed()).toHaveLength(60);
    // Sixty tracks is past the threshold, so the imported library ranks rather than
    // falling back to the fixed ranges.
    expect((await target.repository.get('t30'))?.analysis?.provisional).toBe(false);
  });

  it('keeps the local path when a track is already here', async () => {
    // The point of importing: the analysis travels, the location does not. The same
    // file lives somewhere else on this machine.
    await repository.recordDiscovered([discovered('a', { relPath: 'here/mine.mp3' })]);

    const other = await freshLibrary();
    await other.repository.recordDiscovered([discovered('a', { relPath: 'there/theirs.mp3' })]);
    await other.repository.saveAnalysis('a', features(), 210);
    const exported = await exportLibrary(other.db);

    await importLibrary(db, repository, exported);

    const track = await repository.get('a');
    expect(track?.relPath).toBe('here/mine.mp3');
    expect(track?.analysis?.bpm).toBe(124);
  });

  it('does not overwrite an analysis with a bare record', async () => {
    await repository.recordDiscovered([discovered('a')]);
    await repository.saveAnalysis('a', features(), 210);

    const other = await freshLibrary();
    await other.repository.recordDiscovered([discovered('a')]);
    const exported = await exportLibrary(other.db);

    const summary = await importLibrary(db, repository, exported);
    expect(summary.unchanged).toBe(1);
    expect((await repository.get('a'))?.analysis?.bpm).toBe(124);
  });

  it('takes a better analysis for a track it already has', async () => {
    await repository.recordDiscovered([discovered('a')]);
    await repository.saveAnalysis('a', features({ bpm: 100 }), 210);

    const other = await freshLibrary();
    await other.repository.recordDiscovered([discovered('a')]);
    await other.repository.saveAnalysis('a', features({ bpm: 174 }), 210);
    const exported = await exportLibrary(other.db);
    // Pretend it came from a later pipeline.
    for (const track of exported.tracks) track.analysisVersion = ANALYSIS_VERSION + 1;

    const summary = await importLibrary(db, repository, exported);
    expect(summary.improved).toBe(1);
    expect((await repository.get('a'))?.analysis?.bpm).toBe(174);
  });

  it('is idempotent: importing the same file twice changes nothing the second time', async () => {
    await repository.recordDiscovered([discovered('a')]);
    await repository.saveAnalysis('a', features(), 210);
    await repository.recordPlay('a', 180);
    const exported = await exportLibrary(db);

    const target = await freshLibrary();
    const first = await importLibrary(target.db, target.repository, exported);
    const second = await importLibrary(target.db, target.repository, exported);

    expect(first.added).toBe(1);
    expect(first.playEventsAdded).toBe(1);
    expect(second.added).toBe(0);
    expect(second.unchanged).toBe(1);
    // The one that matters: play counts drive the familiarity slider, and doubling
    // them on every import would quietly skew every queue afterwards.
    expect(second.playEventsAdded).toBe(0);
    expect(await target.db.playHistory.count()).toBe(1);
  });

  it('merges play history from two machines without losing either side', async () => {
    await repository.recordDiscovered([discovered('a')]);
    await db.playHistory.add({ trackId: 'a', playedAt: 1000, playedSec: 100 });

    const exported: LibraryExport = {
      format: EXPORT_FORMAT,
      version: EXPORT_VERSION,
      exportedAt: Date.now(),
      analysisVersion: ANALYSIS_VERSION,
      tracks: [],
      playHistory: [{ trackId: 'a', playedAt: 2000, playedSec: 100 }],
    };

    const summary = await importLibrary(db, repository, exported);
    expect(summary.playEventsAdded).toBe(1);
    expect(await db.playHistory.count()).toBe(2);
  });

  it('rebuilds the distribution rather than adding two libraries together', async () => {
    // Two libraries at opposite ends of the loudness scale. After the merge the
    // percentiles have to describe the combined set, not either half.
    for (let i = 0; i < 40; i++) {
      await repository.recordDiscovered([discovered(`quiet${i}`)]);
      await repository.saveAnalysis(`quiet${i}`, features({ rmsMean: 0.01 + i / 4000 }), 200);
    }

    const other = await freshLibrary();
    for (let i = 0; i < 40; i++) {
      await other.repository.recordDiscovered([discovered(`loud${i}`)]);
      await other.repository.saveAnalysis(`loud${i}`, features({ rmsMean: 0.3 + i / 4000 }), 200);
    }

    await importLibrary(db, repository, await exportLibrary(other.db));

    const quiet = await repository.get('quiet20');
    const loud = await repository.get('loud20');
    expect(quiet?.analysis?.energy).toBeLessThan(0.55);
    expect(loud?.analysis?.energy).toBeGreaterThan(0.45);
    expect(loud?.analysis?.energy).toBeGreaterThan(quiet?.analysis?.energy ?? 1);
  });
});
