/**
 * Building the object graph.
 *
 * Kept out of the component so that start-up order is readable in one place and the
 * component stays about rendering. Nothing here is a singleton: the app creates one
 * set, and the tests can create their own.
 */

import { VibeampDatabase } from '../library/db.js';
import { LibraryRepository } from '../library/repository.js';
import { SessionFiles } from '../library/session.js';
import { AnalysisPool } from '../analysis/pool.js';
import { AutoDj } from '../dj/autoDj.js';
import { DebugStats } from '../debug/stats.js';

export interface Services {
  db: VibeampDatabase;
  repository: LibraryRepository;
  files: SessionFiles;
  pool: AnalysisPool;
  autoDj: AutoDj;
  stats: DebugStats;
  dispose: () => void;
}

export function createServices(): Services {
  const db = new VibeampDatabase();
  const repository = new LibraryRepository(db);
  const files = new SessionFiles();

  const stats = new DebugStats();
  const pool = new AnalysisPool({
    createWorker: () =>
      // Vite turns this into a bundled module worker; the URL form is what it looks
      // for, so it cannot be shortened into a variable.
      new Worker(new URL('../analysis/worker.ts', import.meta.url), { type: 'module' }),
    onProgress: (trackId, stage) => stats.noteStage(trackId, stage),
  });

  const autoDj = new AutoDj({
    repository,
    resolveFile: async (track) => files.resolve(track),
  });

  return {
    db,
    repository,
    files,
    pool,
    autoDj,
    stats,
    dispose: () => {
      pool.dispose();
      files.clear();
      db.close();
    },
  };
}
