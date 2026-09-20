/**
 * Folder scanning.
 *
 * Two routes, because the File System Access API is Chromium only:
 *
 * - `showDirectoryPicker` gives a handle that can be stored and reconnected, which
 *   is the good path.
 * - `<input type="file" webkitdirectory>` gives the files but no handle, so the
 *   folder has to be picked again each session. The cached analysis still applies,
 *   because a track's identity is the hash of its content and not its path.
 */

import { hashFile } from './hash.js';
import type { DiscoveredTrack } from './repository.js';

/**
 * Extensions the scanner accepts.
 *
 * Whether a browser can actually decode one is a separate question, answered by
 * trying: a file that fails is marked unsupported rather than hidden, so the user
 * can see why a track is missing instead of wondering.
 */
export const AUDIO_EXTENSIONS = ['.mp3', '.m4a', '.aac', '.ogg', '.opus', '.wav', '.flac'] as const;

/** Entries handled between yields to the event loop. */
const BATCH_SIZE = 200;

export interface ScanProgress {
  /** Files seen so far. */
  found: number;
  /** Path most recently looked at, for the progress line. */
  currentPath: string;
}

export interface ScanOptions {
  rootId: string;
  onProgress?: (progress: ScanProgress) => void;
  signal?: AbortSignal;
}

/** Whether a name looks like audio this app will try to decode. */
export function isAudioFile(name: string): boolean {
  const lower = name.toLowerCase();
  return AUDIO_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

/** A file found by a scan, with the handle or file needed to read it later. */
export interface ScannedFile {
  track: DiscoveredTrack;
  file: File;
}

/**
 * Walk a directory handle recursively.
 *
 * Yields to the event loop every {@link BATCH_SIZE} entries. Scanning a large folder
 * in one go blocks the main thread for seconds, and the app is meant to be usable
 * while it happens.
 */
export async function* scanDirectory(
  directory: FileSystemDirectoryHandle,
  options: ScanOptions,
): AsyncGenerator<ScannedFile> {
  let seen = 0;
  const queue: Array<{ handle: FileSystemDirectoryHandle; path: string }> = [
    { handle: directory, path: '' },
  ];

  while (queue.length > 0) {
    const next = queue.shift();
    if (next === undefined) break;

    for await (const entry of next.handle.values()) {
      options.signal?.throwIfAborted();
      const path = next.path === '' ? entry.name : `${next.path}/${entry.name}`;

      if (entry.kind === 'directory') {
        queue.push({ handle: entry, path });
        continue;
      }
      if (!isAudioFile(entry.name)) continue;

      const file = await entry.getFile();
      yield {
        track: await describeFile(file, path, options.rootId),
        file,
      };

      seen++;
      options.onProgress?.({ found: seen, currentPath: path });
      if (seen % BATCH_SIZE === 0) await yieldToEventLoop();
    }
  }
}

/**
 * Turn a flat `FileList` from a directory input into the same shape.
 *
 * The fallback route for Firefox and Safari.
 */
export async function* scanFileList(
  files: FileList | readonly File[],
  options: ScanOptions,
): AsyncGenerator<ScannedFile> {
  let seen = 0;
  for (const file of Array.from(files)) {
    options.signal?.throwIfAborted();
    if (!isAudioFile(file.name)) continue;

    // webkitRelativePath is what the directory input gives instead of a handle.
    const path = relativePathOf(file);
    yield { track: await describeFile(file, path, options.rootId), file };

    seen++;
    options.onProgress?.({ found: seen, currentPath: path });
    if (seen % BATCH_SIZE === 0) await yieldToEventLoop();
  }
}

async function describeFile(file: File, relPath: string, rootId: string): Promise<DiscoveredTrack> {
  return {
    id: await hashFile(file),
    rootId,
    relPath,
    fileName: file.name,
    size: file.size,
    lastModified: file.lastModified,
  };
}

function relativePathOf(file: File): string {
  const withPath = file as File & { webkitRelativePath?: string };
  const path = withPath.webkitRelativePath;
  return path === undefined || path === '' ? file.name : path;
}

/**
 * Hand the thread back.
 *
 * `scheduler.yield` is the right primitive and exists in newer Chromium; the
 * `setTimeout` is the fallback everywhere else.
 */
async function yieldToEventLoop(): Promise<void> {
  const scheduler = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (typeof scheduler?.yield === 'function') return scheduler.yield();
  return new Promise((resolve) => {
    window.setTimeout(resolve, 0);
  });
}

/** Whether this browser can store a folder handle and reconnect to it later. */
export function supportsDirectoryHandles(): boolean {
  return (
    typeof (globalThis as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function'
  );
}

/**
 * Ask for read permission on a stored handle.
 *
 * The handle survives a reload but the grant does not, and `requestPermission` only
 * works inside a user gesture. That is why the app always starts behind a reconnect
 * button rather than trying to read files on load.
 */
export async function ensureReadPermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  const queryable = handle as FileSystemDirectoryHandle & {
    queryPermission?: (descriptor: { mode: 'read' }) => Promise<PermissionState>;
    requestPermission?: (descriptor: { mode: 'read' }) => Promise<PermissionState>;
  };

  if ((await queryable.queryPermission?.({ mode: 'read' })) === 'granted') return true;
  return (await queryable.requestPermission?.({ mode: 'read' })) === 'granted';
}
