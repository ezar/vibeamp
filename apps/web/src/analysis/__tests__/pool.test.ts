import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnalysisPool, defaultWorkerCount } from '../pool.js';
import type { AnalysisJob } from '../pool.js';
import { FakeWorker, asWorker } from './fakeWorker.js';
import type { FakeBehaviour } from './fakeWorker.js';

function job(trackId: string, attempts = 0): AnalysisJob {
  return {
    trackId,
    samples: new Float32Array(1024),
    sampleRate: 16000,
    durationSec: 200,
    attempts,
  };
}

let workers: FakeWorker[] = [];
let behaviour: FakeBehaviour = { kind: 'succeed' };

function makePool(workerCount = 2): AnalysisPool {
  return new AnalysisPool({
    workerCount,
    createWorker: () => {
      const fake = new FakeWorker(() => behaviour);
      workers.push(fake);
      return asWorker(fake);
    },
  });
}

beforeEach(() => {
  workers = [];
  behaviour = { kind: 'succeed' };
  FakeWorker.reset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('defaultWorkerCount', () => {
  it('leaves a core for the interface and caps at four', () => {
    expect(defaultWorkerCount(1)).toBe(1);
    expect(defaultWorkerCount(2)).toBe(1);
    expect(defaultWorkerCount(4)).toBe(3);
    expect(defaultWorkerCount(16)).toBe(4);
  });

  it('copes with a browser that will not say', () => {
    expect(defaultWorkerCount(0)).toBe(1);
  });
});

describe('AnalysisPool', () => {
  it('spawns the requested number of workers and initialises each', async () => {
    const pool = makePool(3);
    await pool.analyse(job('a'));
    expect(FakeWorker.created).toBe(3);
    pool.dispose();
  });

  it('returns the descriptors for a job that succeeds', async () => {
    const pool = makePool();
    const outcome = await pool.analyse(job('a'));
    expect(outcome.trackId).toBe('a');
    expect(outcome.features?.bpm).toBe(124);
    expect(outcome.error).toBeUndefined();
    pool.dispose();
  });

  it('never runs more than one job per worker', async () => {
    // The back pressure that keeps the tab alive: one 19 MB buffer per worker, and
    // no more.
    const pool = makePool(2);
    await Promise.all(Array.from({ length: 20 }, (_, i) => pool.analyse(job(`t${i}`))));
    for (const worker of workers) expect(worker.peakInFlight).toBeLessThanOrEqual(1);
    pool.dispose();
  });

  it('queues more jobs than it has workers and finishes all of them', async () => {
    const pool = makePool(2);
    const outcomes = await Promise.all(
      Array.from({ length: 25 }, (_, i) => pool.analyse(job(`t${i}`))),
    );
    expect(outcomes).toHaveLength(25);
    for (const outcome of outcomes) expect(outcome.features).toBeDefined();
    pool.dispose();
  });

  it('spreads work across the workers instead of using one', async () => {
    const pool = makePool(3);
    await Promise.all(Array.from({ length: 30 }, (_, i) => pool.analyse(job(`t${i}`))));
    const busy = workers.filter((worker) => worker.jobsSeen.length > 0);
    expect(busy.length).toBeGreaterThan(1);
    pool.dispose();
  });

  it('reports a free slot only when there is one', async () => {
    const pool = makePool(2);
    // Workers announce themselves on a later turn, so the count settles after a job.
    await pool.analyse(job('warmup'));
    expect(pool.freeSlots()).toBe(2);

    behaviour = { kind: 'hang' };
    void pool.analyse(job('stuck'));
    await pool.waitForSlot();
    expect(pool.freeSlots()).toBe(1);
    pool.dispose();
  });

  it('tells the caller to retry a failure that a retry could fix', async () => {
    const pool = makePool();
    behaviour = { kind: 'fail', code: 'algorithm', fatal: false };
    const outcome = await pool.analyse(job('a'));
    expect(outcome.error?.code).toBe('algorithm');
    expect(outcome.retryable).toBe(true);
    pool.dispose();
  });

  it('gives up on a retryable failure once the attempts run out', async () => {
    const pool = makePool();
    behaviour = { kind: 'fail', code: 'algorithm', fatal: false };
    expect((await pool.analyse(job('a', 3))).retryable).toBe(false);
    pool.dispose();
  });

  it('never retries a file the browser cannot handle', async () => {
    const pool = makePool();
    for (const code of ['bad_input', 'too_short'] as const) {
      behaviour = { kind: 'fail', code, fatal: false };
      expect((await pool.analyse(job('a'))).retryable).toBe(false);
    }
    pool.dispose();
  });

  it('replaces a worker after a fatal error and keeps going', async () => {
    const pool = makePool(1);
    behaviour = { kind: 'fail', code: 'algorithm', fatal: true };
    await pool.analyse(job('poison'));
    expect(FakeWorker.terminated).toBe(1);
    expect(FakeWorker.created).toBe(2);

    // The pool has to be usable afterwards, or one bad file ends the analysis run.
    behaviour = { kind: 'succeed' };
    expect((await pool.analyse(job('fine'))).features).toBeDefined();
    pool.dispose();
  });

  it('gives up on a worker that stops answering, and replaces it', async () => {
    vi.useFakeTimers();
    const pool = makePool(1);
    behaviour = { kind: 'hang' };

    const pending = pool.analyse(job('silent'));
    await vi.advanceTimersByTimeAsync(61_000);
    const outcome = await pending;

    expect(outcome.error?.code).toBe('algorithm');
    expect(outcome.error?.fatal).toBe(true);
    expect(FakeWorker.terminated).toBe(1);
    pool.dispose();
  });

  it('settles both the running job and the queued ones when disposed', async () => {
    // Without this, the analysis loop awaits a job whose worker has been terminated
    // and simply stops, with nothing logged and nothing to see.
    const pool = makePool(1);
    behaviour = { kind: 'hang' };

    const running = pool.analyse(job('running'));
    // Let the worker report ready and pick the first job up.
    await new Promise((resolve) => setTimeout(resolve, 10));
    const queued = pool.analyse(job('queued'));

    pool.dispose();
    for (const outcome of await Promise.all([running, queued])) {
      expect(outcome.error?.code).toBe('cancelled');
      expect(outcome.retryable).toBe(true);
    }
  });

  it('stops waiting for a slot once it has been disposed', async () => {
    const pool = makePool(1);
    behaviour = { kind: 'hang' };
    void pool.analyse(job('running'));
    await new Promise((resolve) => setTimeout(resolve, 10));

    const waiting = pool.waitForSlot();
    pool.dispose();
    await expect(waiting).resolves.toBeUndefined();
  });

  it('refuses new work after disposal instead of hanging', async () => {
    const pool = makePool();
    pool.dispose();
    await expect(pool.analyse(job('late'))).rejects.toThrow(/disposed/);
  });
});
