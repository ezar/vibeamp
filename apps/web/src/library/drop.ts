/**
 * Reading a folder dropped on the player.
 *
 * The discoverable way in. `getAsFileSystemHandle` gives a real directory handle in
 * Chromium, which is the same thing the folder picker returns; `webkitGetAsEntry` is
 * the older interface the rest support, and walks the tree without a handle. Either
 * way what comes back is files, which is all the scanner needs.
 */

/** A dropped directory, however the browser chose to describe it. */
export type DroppedFolder =
  { kind: 'handle'; handle: FileSystemDirectoryHandle } | { kind: 'files'; files: File[] };

/** Entries below this many are walked without yielding; a music folder is deeper. */
const WALK_BATCH = 200;

/**
 * Pull a folder out of a drop, or `null` when nothing in it was one.
 *
 * Files dropped on their own are ignored on purpose: a track with no folder behind
 * it has nowhere to be scanned from, and quietly playing it would leave the library
 * empty and the auto-DJ dead with no explanation.
 */
export async function folderFromDrop(dataTransfer: DataTransfer): Promise<DroppedFolder | null> {
  const items = [...dataTransfer.items].filter((item) => item.kind === 'file');

  for (const item of items) {
    const withHandle = item as DataTransferItem & {
      getAsFileSystemHandle?: () => Promise<FileSystemHandle | null>;
    };

    if (typeof withHandle.getAsFileSystemHandle === 'function') {
      const handle = await withHandle.getAsFileSystemHandle();
      if (handle !== null && handle.kind === 'directory') {
        return { kind: 'handle', handle: handle as FileSystemDirectoryHandle };
      }
      continue;
    }

    const entry = item.webkitGetAsEntry();
    if (entry !== null && entry.isDirectory) {
      return { kind: 'files', files: await walkEntry(entry as FileSystemDirectoryEntry) };
    }
  }

  return null;
}

/** Walk a directory entry into a flat list of files, preserving relative paths. */
async function walkEntry(directory: FileSystemDirectoryEntry): Promise<File[]> {
  const out: File[] = [];
  const queue: FileSystemDirectoryEntry[] = [directory];

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;

    for (const entry of await readEntries(current)) {
      if (entry.isDirectory) {
        queue.push(entry as FileSystemDirectoryEntry);
        continue;
      }
      out.push(await readFile(entry as FileSystemFileEntry));
      if (out.length % WALK_BATCH === 0) await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  return out;
}

/**
 * Read one directory fully.
 *
 * `readEntries` returns at most a hundred entries a call and signals the end with an
 * empty batch, so a single call silently truncates a large music folder.
 */
function readEntries(directory: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => {
    const reader = directory.createReader();
    const all: FileSystemEntry[] = [];

    const readBatch = (): void => {
      reader.readEntries((entries) => {
        if (entries.length === 0) {
          resolve(all);
          return;
        }
        all.push(...entries);
        readBatch();
      }, reject);
    };
    readBatch();
  });
}

function readFile(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}
