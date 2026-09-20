/**
 * Exporting and importing the index.
 *
 * Three uses, and the third is the one that matters day to day: a backup, a way to
 * move a library to another browser without re-analysing it, and a way to get real
 * data in front of the DJ engine when tuning the scoring.
 *
 * Only the index travels. No audio, no folder handles: a handle is meaningless on
 * another machine, and the files themselves are the user's and stay where they are.
 * Tracks are matched by content hash on the way back in, so an export taken on one
 * computer lands correctly on another even when every path is different.
 */

import { ANALYSIS_VERSION } from '@vibeamp/core';
import type { Track } from '@vibeamp/core';
import type { PlayEvent, VibeampDatabase } from './db.js';
import type { LibraryRepository } from './repository.js';

/** Identifies the file, so a wrong one is refused rather than half-read. */
export const EXPORT_FORMAT = 'vibeamp-library';
/** Version of this envelope, not of the analysis pipeline. */
export const EXPORT_VERSION = 1;

export interface LibraryExport {
  format: typeof EXPORT_FORMAT;
  version: number;
  exportedAt: number;
  /** The pipeline version the descriptors came from. */
  analysisVersion: number;
  tracks: Track[];
  playHistory: Array<Omit<PlayEvent, 'id'>>;
}

export interface ImportSummary {
  added: number;
  /** Tracks already present whose analysis was replaced by a better one. */
  improved: number;
  /** Tracks already present that were left alone. */
  unchanged: number;
  playEventsAdded: number;
}

/** The file could not be read as an export. */
export class ImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportError';
  }
}

/** Everything worth keeping, as a JSON blob. */
export async function exportLibrary(db: VibeampDatabase): Promise<LibraryExport> {
  const [tracks, playHistory] = await Promise.all([db.tracks.toArray(), db.playHistory.toArray()]);

  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: Date.now(),
    analysisVersion: ANALYSIS_VERSION,
    tracks,
    // `id` is a local autoincrement and means nothing anywhere else.
    playHistory: playHistory.map(({ trackId, playedAt, playedSec }) => ({
      trackId,
      playedAt,
      playedSec,
    })),
  };
}

/** The export as a file the browser will download. */
export function exportToBlob(data: LibraryExport): Blob {
  return new Blob([JSON.stringify(data)], { type: 'application/json' });
}

/**
 * Whether an incoming record is worth taking over the one already stored.
 *
 * Pure, and the whole merge policy: a newer pipeline wins, and an analysis beats no
 * analysis. Otherwise what is here stays, because re-ranking every track on every
 * import would churn the whole table for nothing.
 */
export function shouldReplace(existing: Track, incoming: Track): boolean {
  if (incoming.analysis === null) return false;
  if (existing.analysis === null) return true;
  return incoming.analysisVersion > existing.analysisVersion;
}

/** Read and validate an export. Throws {@link ImportError} on anything unexpected. */
export function parseExport(text: string): LibraryExport {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ImportError('that file is not JSON');
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new ImportError('that file is not a vibeamp export');
  }
  const candidate = parsed as Partial<LibraryExport>;

  if (candidate.format !== EXPORT_FORMAT) {
    throw new ImportError('that file is not a vibeamp export');
  }
  if (candidate.version !== EXPORT_VERSION) {
    throw new ImportError(
      `this export is version ${String(candidate.version)}; this build reads version ${EXPORT_VERSION}`,
    );
  }
  if (!Array.isArray(candidate.tracks)) {
    throw new ImportError('the export has no tracks in it');
  }

  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: typeof candidate.exportedAt === 'number' ? candidate.exportedAt : Date.now(),
    analysisVersion: typeof candidate.analysisVersion === 'number' ? candidate.analysisVersion : 0,
    tracks: candidate.tracks,
    playHistory: Array.isArray(candidate.playHistory) ? candidate.playHistory : [],
  };
}

/**
 * Merge an export into this library.
 *
 * Paths are **not** taken from the export. A track already here keeps the location
 * it has on this machine; only its analysis can be replaced. An imported track that
 * is new arrives with the exporter's path and no file behind it, which is correct:
 * it is a cached analysis waiting for the scan that finds the audio.
 */
export async function importLibrary(
  db: VibeampDatabase,
  repository: LibraryRepository,
  data: LibraryExport,
): Promise<ImportSummary> {
  const summary: ImportSummary = { added: 0, improved: 0, unchanged: 0, playEventsAdded: 0 };

  await db.transaction('rw', db.tracks, async () => {
    const existing = await db.tracks.bulkGet(data.tracks.map((track) => track.id));
    const rows: Track[] = [];

    data.tracks.forEach((incoming, index) => {
      const current = existing[index];
      if (current === undefined) {
        rows.push(incoming);
        summary.added++;
        return;
      }
      if (!shouldReplace(current, incoming)) {
        summary.unchanged++;
        return;
      }
      rows.push({
        ...current,
        analysis: incoming.analysis,
        analysisVersion: incoming.analysisVersion,
        analyzedAt: incoming.analyzedAt,
        durationSec: incoming.durationSec ?? current.durationSec,
        status: incoming.status,
        attempts: incoming.attempts,
      });
      summary.improved++;
    });

    await db.tracks.bulkPut(rows);
  });

  summary.playEventsAdded = await mergePlayHistory(db, data.playHistory);

  // The distribution now describes a different set of tracks, so it is rebuilt
  // rather than adjusted, and everything is re-ranked against it.
  await repository.rebuildStatistics();
  return summary;
}

/**
 * Add play events that are not already here.
 *
 * Matched on track and timestamp: importing the same file twice must not double
 * every play count and quietly skew the familiarity slider.
 */
async function mergePlayHistory(
  db: VibeampDatabase,
  incoming: ReadonlyArray<Omit<PlayEvent, 'id'>>,
): Promise<number> {
  if (incoming.length === 0) return 0;

  const seen = new Set<string>();
  await db.playHistory.each((event) => seen.add(`${event.trackId}@${event.playedAt}`));

  const fresh = incoming.filter((event) => !seen.has(`${event.trackId}@${event.playedAt}`));
  if (fresh.length > 0) await db.playHistory.bulkAdd(fresh as PlayEvent[]);
  return fresh.length;
}

/** Ask the user for an export file. Resolves `null` if they dismiss the picker. */
export function promptForExport(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.addEventListener('change', () => resolve(input.files?.[0] ?? null));
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}

/** Hand a blob to the browser as a download. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  // Revoked on the next turn: revoking synchronously races the download starting.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
