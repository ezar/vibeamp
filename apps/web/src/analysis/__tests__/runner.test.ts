/**
 * The analysis loop.
 *
 * What is worth protecting here is termination. A runner that spins is invisible:
 * nothing fails, nothing is logged, and the only symptom is a warm laptop.
 */

import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Track } from '@vibeamp/core';
import { VibeampDatabase } from '../../library/db.js';
import { LibraryRepository } from '../../library/repository.js';
import type { DiscoveredTrack } from '../../library/repository.js';
import { AnalysisRunner } from '../runner.js';
import type { AnalysisPool } from '../pool.js';

function discovered(id: string): DiscoveredTrack {
  return {
    id,
    rootId: 'root-1',
    relPath: `music/${id}.mp3`,
    fileName: `${id}.mp3`,
    size: 1000,
    lastModified: 0,
  };
}

/** A pool that is always free and never asked to do anything in these tests. */
function idlePool(): AnalysisPool {
  return {
    waitForSlot: async () => undefined,
    freeSlots: () => 4,
    analyse: async () => {
      throw new Error('the pool should not be reached when no file can be opened');
    },
    dispose: () => undefined,
  } as unknown as AnalysisPool;
}

let db: VibeampDatabase;
let repository: LibraryRepository;
let counter = 0;

beforeEach(async () => {
  db = new VibeampDatabase(`vibeamp-runner-${counter++}`);
  await db.open();
  repository = new LibraryRepository(db);
});

describe('AnalysisRunner', () => {
  it('terminates instead of spinning when nothing can be opened', async () => {
    // The records exist and are pending, but this session cannot see their files —
    // imported from another machine, or left over from a folder that is not
    // connected. The loop used to re-fetch the same records forever at full speed.
    await repository.recordDiscovered(Array.from({ length: 40 }, (_, i) => discovered(`t${i}`)));

    let resolveCalls = 0;
    const runner = new AnalysisRunner({
      repository,
      pool: idlePool(),
      resolveFile: async () => {
        resolveCalls++;
        return null;
      },
    });

    await expect(
      Promise.race([
        runner.run(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('the run never ended')), 4000),
        ),
      ]),
    ).resolves.toBeUndefined();

    // Each record is offered once and then skipped for the rest of the run.
    expect(resolveCalls).toBe(40);
    // They stay pending: the folder may be reconnected later.
    expect((await repository.counts()).pending).toBe(40);
  });

  it('reaches a track queued behind a batch of unreachable ones', async () => {
    // A whole batch of unreachable records used to sit at the head of the query
    // forever, so nothing behind them was ever attempted.
    const ids = Array.from({ length: 40 }, (_, i) => `blocked${i}`);
    await repository.recordDiscovered([...ids, 'reachable'].map(discovered));

    const attempted: string[] = [];
    const runner = new AnalysisRunner({
      repository,
      pool: idlePool(),
      resolveFile: async (track: Track) => {
        attempted.push(track.id);
        if (track.id !== 'reachable') return null;
        // Decoding this fails in Node, which is the point: what matters is that the
        // track was reached at all, and that it then leaves the pending queue.
        return new File([new Uint8Array([1, 2, 3])], 'reachable.mp3');
      },
    });

    await Promise.race([
      runner.run(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('the run never ended')), 8000)),
    ]);

    expect(attempted).toContain('reachable');
    expect((await repository.get('reachable'))?.status).not.toBe('pending');
  });

  it('does nothing at all when there is nothing pending', async () => {
    const runner = new AnalysisRunner({
      repository,
      pool: idlePool(),
      resolveFile: async () => null,
    });
    await expect(runner.run()).resolves.toBeUndefined();
  });

  it('will not start twice over the same queue', async () => {
    await repository.recordDiscovered([discovered('a')]);
    const runner = new AnalysisRunner({
      repository,
      pool: idlePool(),
      resolveFile: async () => null,
    });
    await Promise.all([runner.run(), runner.run()]);
    expect((await repository.counts()).pending).toBe(1);
  });
});
