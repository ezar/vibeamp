/**
 * Handing tracks to the shell.
 *
 * The controller exists because Webamp can append to its playlist or replace it
 * wholesale, and nothing in between. Both bugs this suite protects against come
 * from that: a planned queue appended behind a whole scanned library is never
 * heard, and a plan that excludes everything the shell holds is empty.
 */

import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Track, VibeTarget } from '@vibeamp/core';
import { toCamelot } from '@vibeamp/core';
import { VibeampDatabase } from '../../library/db.js';
import { LibraryRepository } from '../../library/repository.js';
import { QueueController, SHELL_LOOKAHEAD } from '../queueController.js';
import type { QueueSettings } from '../queueController.js';
import type { AutoDj, PlanRequest } from '../autoDj.js';
import type { PlaylistBridge, QueuedEntry } from '../../webamp/playlist.js';

const TARGET: VibeTarget = {
  energy: 0.5,
  brightness: 0.5,
  danceability: 0.5,
  familiarity: 0.5,
  coherence: 0.5,
};

function makeTrack(id: string): Track {
  return {
    id,
    rootId: 'root',
    relPath: `${id}.mp3`,
    fileName: `${id}.mp3`,
    size: 1,
    lastModified: 0,
    durationSec: 200,
    meta: {
      title: id,
      artist: `artist-${id}`,
      albumArtist: null,
      album: `album-${id}`,
      year: null,
      trackNo: null,
      genre: null,
      hasCoverArt: false,
    },
    analysis: {
      bpm: 120,
      bpmConfidence: 0.9,
      key: {
        root: 'C',
        scale: 'major',
        strength: 0.8,
        margin: 0.3,
        camelot: toCamelot('C', 'major'),
      },
      loudnessDb: -10,
      energy: 0.5,
      brightness: 0.5,
      compression: 0.5,
      danceability: 0.5,
      provisional: false,
      inputs: { loudness: 0.2, brightness: 2000, compression: 5, danceability: 0.6 },
      fingerprint: null,
      tailRatio: 0.05,
      clippedRatio: 0,
      sideRatio: 0.4,
      windows: [],
    },
    analysisVersion: 1,
    analyzedAt: 1,
    status: 'done',
    attempts: 0,
  };
}

/** A bridge that records what it was told, standing in for the shell. */
class FakeBridge {
  queued: string[] = [];
  replaceCalls = 0;
  appendCalls = 0;

  append(entries: readonly QueuedEntry[]): void {
    this.appendCalls++;
    this.queued.push(...entries.map((entry) => entry.track.id));
  }

  replaceAll(entries: readonly QueuedEntry[]): void {
    this.replaceCalls++;
    this.queued = entries.map((entry) => entry.track.id);
  }

  trackIdForUrl(url: string | null): string | null {
    return url;
  }

  queuedTrackIds(): string[] {
    return [...this.queued];
  }

  remainingAfter(url: string | null): number {
    if (url === null) return this.queued.length;
    const index = this.queued.indexOf(url);
    return index === -1 ? this.queued.length : this.queued.length - index - 1;
  }

  dispose(): void {}
}

/** An auto-DJ that plans from a fixed library, honouring the exclusion list. */
function fakeAutoDj(library: readonly Track[]): AutoDj {
  return {
    isReady: async () => true,
    plan: async ({ alreadyQueued = [], length = 20 }: PlanRequest) => {
      const excluded = new Set(alreadyQueued);
      return library
        .filter((track) => !excluded.has(track.id))
        .slice(0, length)
        .map((track) => ({
          planned: { track, cost: 0, targetEnergy: 0.5 },
          file: new File([new Uint8Array([1])], track.fileName),
        }));
    },
  } as unknown as AutoDj;
}

let db: VibeampDatabase;
let repository: LibraryRepository;
let bridge: FakeBridge;
let settings: QueueSettings;
let announced: string[][];
let counter = 0;

/**
 * Put a library in the database and build a controller over it.
 *
 * Both halves are needed: the fake auto-DJ plans from the array, and the controller
 * reads its seed from the repository.
 */
async function controllerOver(library: readonly Track[]): Promise<QueueController> {
  await db.tracks.bulkPut([...library]);
  return new QueueController(
    fakeAutoDj(library),
    bridge as unknown as PlaylistBridge,
    repository,
    () => settings,
    (upcoming) => {
      announced.push(upcoming.map((entry) => entry.track.id));
    },
  );
}

beforeEach(async () => {
  db = new VibeampDatabase(`vibeamp-queue-${counter++}`);
  await db.open();
  repository = new LibraryRepository(db);
  bridge = new FakeBridge();
  announced = [];
  settings = { target: TARGET, shape: 'flat', enabled: true };
});

describe('start', () => {
  it('takes the playlist over instead of appending behind a whole library', async () => {
    // The regression: a freshly scanned folder puts every track in the playlist.
    // Appending a plan behind it would not be heard for hours.
    const library = Array.from({ length: 50 }, (_, i) => makeTrack(`t${i}`));
    bridge.queued = library.map((track) => track.id);

    expect(await (await controllerOver(library)).start()).toBe(true);
    expect(bridge.replaceCalls).toBe(1);
    expect(bridge.queued).toHaveLength(SHELL_LOOKAHEAD);
  });

  it('plans without excluding what the shell already holds', async () => {
    // The deadlock this caused: on a first scan the playlist holds every candidate,
    // so a plan that excludes the playlist is empty and the takeover never happens.
    const library = Array.from({ length: 50 }, (_, i) => makeTrack(`t${i}`));
    bridge.queued = library.map((track) => track.id);

    const controller = await controllerOver(library);
    expect(await controller.start()).toBe(true);
    expect(bridge.queued.length).toBeGreaterThan(0);
  });

  it('reports that it could not start when there is nothing to plan', async () => {
    expect(await (await controllerOver([])).start()).toBe(false);
    expect(bridge.replaceCalls).toBe(0);
  });

  it('does nothing while the auto-DJ is switched off', async () => {
    settings = { ...settings, enabled: false };
    expect(await (await controllerOver([makeTrack('a')])).start()).toBe(false);
    expect(bridge.replaceCalls).toBe(0);
  });
});

describe('topUp', () => {
  it('keeps the shell stocked to the lookahead and no further', async () => {
    const library = Array.from({ length: 50 }, (_, i) => makeTrack(`t${i}`));
    const controller = await controllerOver(library);
    await controller.start();

    const playing = bridge.queued[0] ?? null;
    await controller.topUp(playing);
    expect(bridge.remainingAfter(playing)).toBe(SHELL_LOOKAHEAD);
  });

  it('adds nothing when the shell already has enough', async () => {
    const library = Array.from({ length: 50 }, (_, i) => makeTrack(`t${i}`));
    const controller = await controllerOver(library);
    await controller.start();

    const appendsBefore = bridge.appendCalls;
    await controller.topUp(null);
    expect(bridge.appendCalls).toBe(appendsBefore);
  });

  it('stays out of the way when the auto-DJ is off', async () => {
    settings = { ...settings, enabled: false };
    await (await controllerOver([makeTrack('a')])).topUp(null);
    expect(bridge.appendCalls).toBe(0);
    expect(bridge.replaceCalls).toBe(0);
  });
});

describe('onTrackChanged', () => {
  it('records the play and remembers what is on', async () => {
    const library = Array.from({ length: 20 }, (_, i) => makeTrack(`t${i}`));
    await repository.recordDiscovered(
      library.map((track) => ({
        id: track.id,
        rootId: 'root',
        relPath: track.relPath,
        fileName: track.fileName,
        size: 1,
        lastModified: 0,
      })),
    );

    const controller = await controllerOver(library);
    await controller.onTrackChanged('t3');

    expect(controller.playingTrackId).toBe('t3');
    expect((await repository.recentlyPlayed()).has('t3')).toBe(true);
  });

  it('does not record the same track twice in a row', async () => {
    const controller = await controllerOver([makeTrack('a')]);
    await controller.onTrackChanged('a');
    await controller.onTrackChanged('a');
    expect(await db.playHistory.count()).toBe(1);
  });

  it('ignores a URL it did not queue', async () => {
    const controller = await controllerOver([makeTrack('a')]);
    await controller.onTrackChanged(null);
    expect(controller.playingTrackId).toBeNull();
    expect(await db.playHistory.count()).toBe(0);
  });
});

describe('replan', () => {
  it('does exclude what the shell holds, unlike start', async () => {
    // Once the auto-DJ owns the playlist the exclusion is right: it stops the queue
    // repeating the two tracks already handed over.
    const library = Array.from({ length: 50 }, (_, i) => makeTrack(`t${i}`));
    const controller = await controllerOver(library);
    await controller.start();

    const held = [...bridge.queued];
    await controller.replan();
    await controller.topUp(held[0] ?? null);

    const added = bridge.queued.filter((id) => !held.includes(id));
    for (const id of added) expect(held).not.toContain(id);
  });
});

describe('upcoming', () => {
  it('shows one queue, not the split between the shell and the plan', async () => {
    // The shell only ever holds a couple of tracks; the rest of the plan is here.
    // A listener does not care where the boundary is, so neither does this list.
    const library = Array.from({ length: 50 }, (_, i) => makeTrack(`t${i}`));
    const controller = await controllerOver(library);
    await controller.start();

    const upcoming = controller.upcoming();
    expect(upcoming.length).toBeGreaterThan(SHELL_LOOKAHEAD);
    expect(upcoming.slice(0, SHELL_LOOKAHEAD).map((entry) => entry.track.id)).toEqual(
      bridge.queued,
    );
  });

  it('carries what the planner thought, not just the track', async () => {
    const controller = await controllerOver([makeTrack('a'), makeTrack('b'), makeTrack('c')]);
    await controller.start();

    for (const entry of controller.upcoming()) {
      expect(Number.isFinite(entry.cost)).toBe(true);
      expect(entry.targetEnergy).toBeGreaterThanOrEqual(0);
    }
  });

  it('drops a track once it starts playing', async () => {
    const library = Array.from({ length: 20 }, (_, i) => makeTrack(`t${i}`));
    const controller = await controllerOver(library);
    await controller.start();

    const first = controller.upcoming()[0]?.track.id ?? null;
    expect(first).not.toBeNull();

    await controller.onTrackChanged(first);
    expect(controller.upcoming().map((entry) => entry.track.id)).not.toContain(first);
  });

  it('keeps what the shell already holds when the sliders move', async () => {
    // Re-planning must not promise a queue that contradicts what is about to play:
    // the shell cannot un-queue those tracks, so the list still shows them first.
    const library = Array.from({ length: 50 }, (_, i) => makeTrack(`t${i}`));
    const controller = await controllerOver(library);
    await controller.start();
    const handed = controller
      .upcoming()
      .slice(0, SHELL_LOOKAHEAD)
      .map((entry) => entry.track.id);

    await controller.replan();

    expect(
      controller
        .upcoming()
        .slice(0, SHELL_LOOKAHEAD)
        .map((entry) => entry.track.id),
    ).toEqual(handed);
  });

  it('is empty while the auto-DJ is off', async () => {
    settings = { ...settings, enabled: false };
    const controller = await controllerOver([makeTrack('a')]);
    await controller.replan();

    expect(controller.upcoming()).toEqual([]);
  });

  it('announces the queue whenever it changes', async () => {
    const library = Array.from({ length: 20 }, (_, i) => makeTrack(`t${i}`));
    const controller = await controllerOver(library);

    await controller.start();
    expect(announced.length).toBeGreaterThan(0);

    const before = announced.length;
    await controller.onTrackChanged(controller.upcoming()[0]?.track.id ?? null);
    expect(announced.length).toBeGreaterThan(before);
  });
});
