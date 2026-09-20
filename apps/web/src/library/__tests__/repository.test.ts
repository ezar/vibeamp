/**
 * Repository tests, against fake-indexeddb.
 *
 * The state machine a track goes through is where a library layer goes wrong in
 * ways the user notices months later: an analysis silently discarded, a file
 * re-analysed on every scan, a retry loop that never gives up. All of it is
 * testable without a browser.
 */

import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { ANALYSIS_VERSION, MIN_TRACKS_FOR_PERCENTILES } from '@vibeamp/core';
import type { RawFeatures } from '@vibeamp/core';
import { VibeampDatabase } from '../db.js';
import { LibraryRepository } from '../repository.js';
import type { DiscoveredTrack } from '../repository.js';

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
    windows: [{ startSec: 10, rms: 0.2, centroidHz: 2200, flux: 12, zcr: 0.08, lowBandRatio: 0.3 }],
    ...overrides,
  };
}

let db: VibeampDatabase;
let repository: LibraryRepository;
let dbCounter = 0;

beforeEach(async () => {
  // A fresh database per test: Dexie keeps connections open, and a shared one leaks
  // state between tests in exactly the way that makes an ordering bug look random.
  db = new VibeampDatabase(`vibeamp-test-${dbCounter++}`);
  await db.open();
  repository = new LibraryRepository(db);
});

describe('recordDiscovered', () => {
  it('queues every newly found track', async () => {
    const queued = await repository.recordDiscovered([discovered('a'), discovered('b')]);
    expect(queued).toBe(2);
    expect((await repository.counts()).pending).toBe(2);
  });

  it('does nothing for an empty scan', async () => {
    expect(await repository.recordDiscovered([])).toBe(0);
  });

  it('does not re-queue a track that is already analysed', async () => {
    await repository.recordDiscovered([discovered('a')]);
    await repository.saveAnalysis('a', features(), 210);

    const queued = await repository.recordDiscovered([discovered('a')]);
    expect(queued).toBe(0);
    expect((await repository.get('a'))?.status).toBe('done');
  });

  it('keeps the analysis when a file is renamed, and updates the path', async () => {
    // The whole reason identity is a content hash. Renaming a file must not cost the
    // user the minutes it took to analyse it.
    await repository.recordDiscovered([discovered('a', { relPath: 'old/name.mp3' })]);
    await repository.saveAnalysis('a', features(), 210);

    await repository.recordDiscovered([
      discovered('a', { relPath: 'new/better name.mp3', fileName: 'better name.mp3' }),
    ]);

    const track = await repository.get('a');
    expect(track?.status).toBe('done');
    expect(track?.analysis).not.toBeNull();
    expect(track?.relPath).toBe('new/better name.mp3');
    expect(track?.fileName).toBe('better name.mp3');
  });

  it('re-queues a track analysed by an older pipeline, keeping its metadata', async () => {
    await repository.recordDiscovered([discovered('a')]);
    await repository.saveAnalysis('a', features(), 210);
    await db.tracks.update('a', { analysisVersion: ANALYSIS_VERSION - 1 });

    const queued = await repository.recordDiscovered([discovered('a')]);
    expect(queued).toBe(1);

    const track = await repository.get('a');
    expect(track?.status).toBe('pending');
    expect(track?.attempts).toBe(0);
    // The old numbers stay readable until better ones replace them, so the player
    // keeps working while the library re-analyses in the background.
    expect(track?.analysis).not.toBeNull();
  });
});

describe('failures', () => {
  it('marks a retryable failure as failed so it is picked up again', async () => {
    await repository.recordDiscovered([discovered('a')]);
    await repository.recordFailure('a', 'a descriptor threw', true);

    const track = await repository.get('a');
    expect(track?.status).toBe('failed');
    expect(track?.attempts).toBe(1);
    expect(await repository.pendingTracks(10)).toHaveLength(1);
  });

  it('marks an undecodable file unsupported and stops offering it', async () => {
    await repository.recordDiscovered([discovered('a')]);
    await repository.recordFailure('a', 'the browser cannot decode this', false);

    expect((await repository.get('a'))?.status).toBe('unsupported');
    expect(await repository.pendingTracks(10)).toHaveLength(0);
  });

  it('ignores a failure for a track it has never seen', async () => {
    await expect(repository.recordFailure('ghost', 'nope', true)).resolves.toBeUndefined();
  });
});

describe('saveAnalysis', () => {
  it('stores the descriptors and clears the error', async () => {
    await repository.recordDiscovered([discovered('a')]);
    await repository.recordFailure('a', 'transient', true);
    await repository.saveAnalysis('a', features(), 210);

    const track = await repository.get('a');
    expect(track?.status).toBe('done');
    expect(track?.durationSec).toBe(210);
    expect(track?.analysis?.bpm).toBe(124);
    expect(track?.analysis?.key.camelot).toBe('8A');
    expect(track?.errorMessage).toBeUndefined();
  });

  it('marks early tracks provisional and settles once the library is big enough', async () => {
    for (let i = 0; i < MIN_TRACKS_FOR_PERCENTILES; i++) {
      await repository.recordDiscovered([discovered(`t${i}`)]);
      await repository.saveAnalysis(`t${i}`, features({ rmsMean: 0.05 + i / 500 }), 200);
    }

    // Crossing the threshold re-normalises everything analysed so far, so no track
    // is left carrying a percentile from the provisional scale.
    const all = await repository.allAnalysed();
    expect(all).toHaveLength(MIN_TRACKS_FOR_PERCENTILES);
    for (const track of all) expect(track.analysis?.provisional).toBe(false);
  });

  it('ranks tracks against each other once percentiles are in use', async () => {
    for (let i = 0; i < 80; i++) {
      await repository.recordDiscovered([discovered(`t${i}`)]);
      await repository.saveAnalysis(`t${i}`, features({ rmsMean: i / 400 }), 200);
    }

    const quiet = await repository.get('t2');
    const loud = await repository.get('t78');
    expect(loud?.analysis?.energy).toBeGreaterThan(quiet?.analysis?.energy ?? 1);
  });

  it('re-normalises idempotently, so repeating it does not drift', async () => {
    // Exactness is the point: the percentiles are recomputed from the stored inputs,
    // not derived back out of the previous percentiles, so running it again is a
    // no-op instead of walking the values towards the middle.
    for (let i = 0; i < 60; i++) {
      await repository.recordDiscovered([discovered(`t${i}`)]);
      await repository.saveAnalysis(`t${i}`, features({ rmsMean: i / 300 }), 200);
    }

    await repository.renormaliseAll();
    const once = (await repository.get('t30'))?.analysis;
    await repository.renormaliseAll();
    await repository.renormaliseAll();
    const thrice = (await repository.get('t30'))?.analysis;

    expect(thrice?.energy).toBe(once?.energy);
    expect(thrice?.compression).toBe(once?.compression);
    expect(thrice?.danceability).toBe(once?.danceability);
  });

  it('refreshes a stale percentile when the library has grown since', async () => {
    // Percentiles written earlier are measured against a smaller library, so they go
    // stale as it grows. That is deliberate, because re-ranking on every save would
    // rewrite the whole table each time; re-normalising is what brings them level.
    for (let i = 0; i < 60; i++) {
      await repository.recordDiscovered([discovered(`t${i}`)]);
      await repository.saveAnalysis(`t${i}`, features({ rmsMean: i / 300 }), 200);
    }

    const stale = (await repository.get('t30'))?.analysis?.energy;
    await repository.renormaliseAll();
    const fresh = (await repository.get('t30'))?.analysis?.energy;

    // t30 sits at the thirtieth of sixty values, so a refreshed percentile is 0.5;
    // the stored one still reflects the fifty tracks that existed when it was last
    // ranked.
    expect(fresh).toBeCloseTo(0.5, 6);
    expect(stale).not.toBe(fresh);
  });
});

describe('play history', () => {
  it('reports a track played inside the window and forgets an older one', async () => {
    await repository.recordPlay('recent', 180);
    await db.playHistory.add({
      trackId: 'ancient',
      playedAt: Date.now() - 10 * 60 * 60 * 1000,
      playedSec: 180,
    });

    const recent = await repository.recentlyPlayed();
    expect(recent.has('recent')).toBe(true);
    expect(recent.has('ancient')).toBe(false);
  });

  it('scales play counts against the most played track', async () => {
    for (let i = 0; i < 5; i++) await repository.recordPlay('favourite', 200);
    await repository.recordPlay('once', 200);

    const frequencies = await repository.playFrequencies();
    expect(frequencies.get('favourite')).toBe(1);
    expect(frequencies.get('once')).toBeCloseTo(0.2, 6);
    expect(frequencies.get('never')).toBeUndefined();
  });

  it('has no frequencies at all for an untouched library', async () => {
    expect((await repository.playFrequencies()).size).toBe(0);
  });
});
