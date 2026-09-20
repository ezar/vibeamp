/**
 * A worker that speaks the real protocol, without a browser.
 *
 * The pool is the component the specification calls the biggest technical risk, so
 * it is worth testing properly: back pressure, replacement after a fatal error, the
 * timeout and the retry decision are all logic, and none of them need a real thread.
 */

import type { FromWorker, ToWorker } from '@vibeamp/analysis';
import type { RawFeatures } from '@vibeamp/core';

export type FakeBehaviour =
  | { kind: 'succeed' }
  /** Answer with an error of this code. */
  | { kind: 'fail'; code: 'bad_input' | 'too_short' | 'algorithm'; fatal: boolean }
  /** Never answer, so the pool's timeout is what resolves the job. */
  | { kind: 'hang' };

export function sampleFeatures(): RawFeatures {
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
    windows: [],
  };
}

export class FakeWorker {
  static created = 0;
  static terminated = 0;
  /** Jobs each instance was asked to run, so a test can assert on distribution. */
  readonly jobsSeen: string[] = [];
  /** How many jobs this instance is running right now. */
  inFlight = 0;
  /** Highest concurrent job count this instance ever reached. */
  peakInFlight = 0;

  private readonly listeners = new Map<string, Set<(event: unknown) => void>>();
  private alive = true;

  constructor(private readonly behaviour: () => FakeBehaviour) {
    FakeWorker.created++;
  }

  static reset(): void {
    FakeWorker.created = 0;
    FakeWorker.terminated = 0;
  }

  addEventListener(type: string, listener: (event: unknown) => void): void {
    const existing = this.listeners.get(type) ?? new Set();
    existing.add(listener);
    this.listeners.set(type, existing);
  }

  removeEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  terminate(): void {
    this.alive = false;
    FakeWorker.terminated++;
  }

  postMessage(message: ToWorker): void {
    if (!this.alive) return;

    if (message.type === 'init') {
      this.reply({ type: 'ready', payload: { analysisVersion: 1 } });
      return;
    }
    if (message.type !== 'analyze') return;

    const { jobId } = message.payload;
    this.jobsSeen.push(jobId);
    this.inFlight++;
    this.peakInFlight = Math.max(this.peakInFlight, this.inFlight);

    const behaviour = this.behaviour();
    if (behaviour.kind === 'hang') return;

    // A real worker answers on a later turn, and the pool must not depend on the
    // answer arriving synchronously inside postMessage.
    queueMicrotask(() => {
      if (!this.alive) return;
      this.inFlight--;
      if (behaviour.kind === 'succeed') {
        this.reply({ type: 'result', payload: { jobId, features: sampleFeatures() } });
      } else {
        this.reply({
          type: 'error',
          payload: {
            jobId,
            code: behaviour.code,
            message: `fake failure: ${behaviour.code}`,
            fatal: behaviour.fatal,
          },
        });
      }
    });
  }

  private reply(message: FromWorker): void {
    queueMicrotask(() => {
      if (!this.alive) return;
      for (const listener of this.listeners.get('message') ?? []) listener({ data: message });
    });
  }
}

/** The fake, typed as the `Worker` the pool expects. */
export function asWorker(fake: FakeWorker): Worker {
  return fake as unknown as Worker;
}
