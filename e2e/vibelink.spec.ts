import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { rmSync } from 'node:fs';

import { MIN_ANALYSED_TRACKS } from '../packages/dj/src/queue.js';
import { decodeVibe, encodeVibe } from '../packages/dj/src/vibeLink.js';
import { writeLibrary } from './fixtures/library.js';

/**
 * A vibe travelling in a URL.
 *
 * The one thing this player can share. It works because the sliders are positions
 * on percentiles each library computes for itself, so the same six numbers mean
 * something in a collection they were never set against — and because of that, the
 * link needs no server and carries no music.
 */

const SHARED = encodeVibe({
  target: {
    energy: 0.86,
    brightness: 0.2,
    danceability: 0.55,
    familiarity: 0,
    coherence: 1,
  },
  shape: 'winddown',
});

/**
 * The slider values a page is showing, in the order the window draws them.
 *
 * Waits for the first fader rather than trusting that `#main-window` being visible
 * means the vibe window exists. It does not: `#main-window` is Webamp's, and the
 * shell is built before the panel beside it mounts. Under load that gap is wide
 * enough to read an empty list of sliders and call it a mismatch.
 */
async function faders(page: Page): Promise<number[]> {
  const inputs = page.locator('.vibe-window input[type=range]');
  await inputs.first().waitFor();
  return inputs.evaluateAll((elements) =>
    elements.map((input) => Number((input as HTMLInputElement).value)),
  );
}

test('opens with the sliders a link asked for', async ({ page }) => {
  await page.goto(`/?vibe=${SHARED}`);
  await expect(page.locator('#main-window')).toBeVisible();

  // A byte per slider: within half a percent of what was shared.
  expect(await faders(page)).toEqual([86, 20, 55, 0, 100]);
  await expect(page.locator('#vibe-shape')).toHaveValue('winddown');
  await expect(page.locator('.vibe-window')).toContainText('from a shared link');
});

test('opens plainly when there is no link', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#main-window')).toBeVisible();

  await expect(page.locator('.vibe-window')).not.toContainText('from a shared link');
  expect(await faders(page)).not.toEqual([86, 20, 55, 0, 100]);
});

test('ignores a link it cannot read rather than half-applying it', async ({ page }) => {
  // Five values decoded into six sliders is not an error anyone would notice: the
  // queue would reorder and nothing on screen would say why.
  const plain = await (async () => {
    await page.goto('/');
    await expect(page.locator('#main-window')).toBeVisible();
    return faders(page);
  })();

  await page.goto(`/?vibe=2${SHARED.slice(1)}`);
  await expect(page.locator('#main-window')).toBeVisible();

  expect(await faders(page)).toEqual(plain);
  await expect(page.locator('.vibe-window')).not.toContainText('from a shared link');
});

test('copies a link that reproduces the sliders it was copied from', async ({ page, context }) => {
  // The whole claim, end to end: the button is only enabled once a library is
  // analysed, and what it puts on the clipboard has to set the same faders on a
  // fresh load. Anything less is a string that looks like a link.
  const library = writeLibrary(MIN_ANALYSED_TRACKS + 2);
  try {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.addInitScript(() => {
      delete (window as { showDirectoryPicker?: unknown }).showDirectoryPicker;
    });

    await page.goto(`/?vibe=${SHARED}`);
    await expect(page.locator('#main-window')).toBeVisible();

    const chooser = page.waitForEvent('filechooser');
    await page.locator('.vibe-window').getByRole('button', { name: 'OPEN FOLDER' }).click();
    await (await chooser).setFiles(library.dir);
    await expect(page.locator('.vibe-count')).toHaveText(`${library.tracks.length} analysed`, {
      timeout: 180_000,
    });

    const before = await faders(page);
    await page.locator('.vibe-window').getByRole('button', { name: 'Link', exact: true }).click();
    await expect(page.locator('.vibe-window')).toContainText('Vibe link copied');

    const link = await page.evaluate(() => navigator.clipboard.readText());
    const code = new URL(link).searchParams.get('vibe');
    expect(code).not.toBeNull();
    expect(decodeVibe(code!)).not.toBeNull();

    await page.goto(`/?vibe=${code}`);
    await expect(page.locator('#main-window')).toBeVisible();
    expect(await faders(page)).toEqual(before);
  } finally {
    rmSync(library.dir, { recursive: true, force: true });
  }
});
