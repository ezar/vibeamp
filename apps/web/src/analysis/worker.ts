/**
 * The analysis worker.
 *
 * Deliberately thin. All it does is receive samples, call the pipeline and post the
 * numbers back; the pipeline itself lives in `@vibeamp/analysis` and is tested in
 * Node. Nothing here touches a file or the database, so there is no state to get
 * wrong and nothing to leak.
 */

import { ANALYSIS_VERSION, ExtractionError, extractFeatures } from '@vibeamp/analysis';
import type { FromWorker, ToWorker, WorkerError } from '@vibeamp/analysis';

/** Jobs the pool has withdrawn. Checked between stages of the pipeline. */
const cancelled = new Set<string>();

function post(message: FromWorker): void {
  self.postMessage(message);
}

self.addEventListener('message', (event: MessageEvent<ToWorker>) => {
  const message = event.data;

  switch (message.type) {
    case 'init':
      post({ type: 'ready', payload: { analysisVersion: ANALYSIS_VERSION } });
      return;

    case 'cancel':
      // A job that already finished is cancelled silently; the pool does not need to
      // know it lost the race.
      cancelled.add(message.payload.jobId);
      return;

    case 'dispose':
      self.close();
      return;

    case 'analyze': {
      const { jobId, samples, sampleRate } = message.payload;
      try {
        const features = extractFeatures(samples, sampleRate, {
          onProgress: (stage, pct) => post({ type: 'progress', payload: { jobId, stage, pct } }),
          shouldCancel: () => cancelled.has(jobId),
        });
        post({ type: 'result', payload: { jobId, features } });
      } catch (error) {
        post({ type: 'error', payload: describe(jobId, error) });
      } finally {
        cancelled.delete(jobId);
      }
      return;
    }
  }
});

function describe(jobId: string, error: unknown): WorkerError {
  if (error instanceof ExtractionError) {
    return { jobId, code: error.code, message: error.message, fatal: false };
  }
  // Anything the pipeline did not raise itself is not understood, so the worker is
  // treated as compromised and the pool replaces it.
  return {
    jobId,
    code: 'algorithm',
    message: error instanceof Error ? error.message : String(error),
    fatal: true,
  };
}
