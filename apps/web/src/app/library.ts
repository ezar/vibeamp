/**
 * Connecting a folder.
 *
 * Both routes end in the same place: a list of files indexed by content hash, with
 * the `File` objects kept for the session so they can be decoded and played.
 */

import { scanDirectory, scanFileList, supportsDirectoryHandles } from '../library/scan.js';
import type { ScanProgress, ScannedFile } from '../library/scan.js';
import { readMeta } from '../library/metadata.js';
import type { Services } from './services.js';

/** The one root this version supports. Several folders is a later concern. */
export const ROOT_ID = 'root-1';

/**
 * Ask for a folder and index everything in it.
 *
 * @returns The files found, or `null` when the user dismissed the picker.
 */
export async function connectFolder(
  services: Services,
  onProgress: (progress: ScanProgress) => void,
): Promise<ScannedFile[] | null> {
  const source = supportsDirectoryHandles() ? await pickDirectory() : await pickWithFileInput();
  if (source === null) return null;

  const scanned: ScannedFile[] = [];
  const options = { rootId: ROOT_ID, onProgress };
  const files =
    source.kind === 'handle'
      ? scanDirectory(source.handle, options)
      : scanFileList(source.files, options);

  for await (const entry of files) {
    scanned.push(entry);
    services.files.add(entry.track.id, entry.file);
  }

  await services.repository.recordDiscovered(scanned.map((entry) => entry.track));
  return scanned;
}

/**
 * Read tags and write them as they arrive.
 *
 * Deliberately after the playlist exists. Parsing tags for a few thousand files
 * takes a while, and there is no reason the user cannot press play during it.
 */
export async function readTagsInBackground(
  services: Services,
  scanned: readonly ScannedFile[],
): Promise<void> {
  for (const entry of scanned) {
    const meta = await readMeta(entry.file);
    await services.db.tracks.update(entry.track.id, { meta });
  }
}

type FolderSource =
  { kind: 'handle'; handle: FileSystemDirectoryHandle } | { kind: 'files'; files: FileList };

async function pickDirectory(): Promise<FolderSource | null> {
  const picker = (globalThis as { showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle> })
    .showDirectoryPicker;
  if (picker === undefined) return pickWithFileInput();

  try {
    return { kind: 'handle', handle: await picker() };
  } catch {
    // Dismissing the picker throws. That is not an error worth showing.
    return null;
  }
}

/** The fallback for Firefox and Safari, which have no folder picker. */
function pickWithFileInput(): Promise<FolderSource | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.setAttribute('webkitdirectory', '');
    input.addEventListener('change', () =>
      resolve(input.files === null ? null : { kind: 'files', files: input.files }),
    );
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}
