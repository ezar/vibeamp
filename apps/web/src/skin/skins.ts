/**
 * Skins.
 *
 * Webamp parses real `.wsz` files, so vibeamp does not need a skin format of its
 * own and does not ship a single skin: classic skins are the work of their authors,
 * and redistributing them is not ours to do. The user brings the ones they already
 * have, they are kept in IndexedDB, and they appear in the shell's own skin menu on
 * the next start — which is where a Winamp user looks for them.
 */

import { SETTING_KEYS, readSetting, writeSetting } from '../library/db.js';
import type { StoredSkin, VibeampDatabase } from '../library/db.js';

/** What the shell's `availableSkins` option wants. */
export interface SkinChoice {
  url: string;
  name: string;
}

/** A skin loaded and ready to hand to the shell. */
export interface LoadedSkins {
  choices: SkinChoice[];
  /** The one to start with, or `undefined` for the shell's built-in default. */
  initial: SkinChoice | undefined;
  /** Releases every URL this created. */
  dispose: () => void;
}

/** Whether a file looks like a Winamp skin. */
export function isSkinFile(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.endsWith('.wsz') || lower.endsWith('.zip');
}

/** The name to show, without the extension. */
export function skinDisplayName(fileName: string): string {
  return fileName.replace(/\.(wsz|zip)$/i, '');
}

/** Store a skin the user picked. Returns the stored record. */
export async function saveSkin(db: VibeampDatabase, file: File): Promise<StoredSkin> {
  const skin: StoredSkin = {
    id: crypto.randomUUID(),
    name: skinDisplayName(file.name),
    // Copied into a plain Blob: a File is a handle onto something on disk, and the
    // user is free to move or delete that the moment after they pick it.
    data: new Blob([await file.arrayBuffer()], { type: 'application/zip' }),
    addedAt: Date.now(),
  };
  await db.skins.put(skin);
  return skin;
}

/**
 * Load every stored skin, ready for the shell.
 *
 * The object URLs live as long as the Webamp instance does, so they are released
 * through the returned `dispose` rather than after use: the shell re-reads a skin's
 * URL whenever the user picks it from the menu again.
 */
export async function loadSkins(db: VibeampDatabase): Promise<LoadedSkins> {
  const stored = await db.skins.orderBy('addedAt').toArray();
  const urls: string[] = [];

  const choices = stored.map((skin) => {
    const url = URL.createObjectURL(skin.data);
    urls.push(url);
    return { url, name: skin.name };
  });

  const lastId = await readSetting<string | null>(db, SETTING_KEYS.lastSkinId, null);
  const lastIndex = lastId === null ? -1 : stored.findIndex((skin) => skin.id === lastId);

  return {
    choices,
    initial: lastIndex === -1 ? undefined : choices[lastIndex],
    dispose: () => {
      for (const url of urls) URL.revokeObjectURL(url);
    },
  };
}

/** Remember which skin to start with next time. */
export async function rememberSkin(db: VibeampDatabase, skinId: string): Promise<void> {
  await writeSetting(db, SETTING_KEYS.lastSkinId, skinId);
}

/** Forget a skin. Its blob goes with it. */
export async function removeSkin(db: VibeampDatabase, skinId: string): Promise<void> {
  await db.skins.delete(skinId);
  const lastId = await readSetting<string | null>(db, SETTING_KEYS.lastSkinId, null);
  if (lastId === skinId) await writeSetting(db, SETTING_KEYS.lastSkinId, null);
}

/** Ask the user for a `.wsz`. Resolves `null` if they dismiss the picker. */
export function promptForSkin(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.wsz,.zip';
    input.addEventListener('change', () => resolve(input.files?.[0] ?? null));
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}
