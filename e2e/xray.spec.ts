import { expect, test } from '@playwright/test';
import { rmSync } from 'node:fs';

import { writeDuplicateLibrary } from './fixtures/library.js';

/**
 * The library window: the two things a player that listens can say and a service
 * with tags cannot.
 *
 * Both claims are made against a real folder, analysed in the browser by the real
 * worker pool, because both are only worth anything if they survive the pipeline.
 * The duplicate pair in the fixture shares nothing but its sound: different file
 * names, no tags, a different length in bytes.
 */

test('shows the shape of a collection and finds the copy that the names hide', async ({ page }) => {
  const library = writeDuplicateLibrary();
  try {
    await page.addInitScript(() => {
      delete (window as { showDirectoryPicker?: unknown }).showDirectoryPicker;
    });

    await page.goto('/');
    await expect(page.locator('#main-window')).toBeVisible();

    // Nothing to X-ray before a folder is connected, and the button says so.
    await expect(
      page.locator('.vibe-window').getByRole('button', { name: 'X-ray' }),
    ).toBeDisabled();

    const chooser = page.waitForEvent('filechooser');
    await page.locator('.vibe-window').getByRole('button', { name: 'OPEN FOLDER' }).click();
    await (await chooser).setFiles(library.dir);
    await expect(page.locator('.vibe-count')).toHaveText(`${library.tracks.length} analysed`, {
      timeout: 180_000,
    });

    await page.locator('.vibe-window').getByRole('button', { name: 'X-ray' }).click();
    const window_ = page.locator('.library-window');
    await expect(window_).toBeVisible();
    await expect(window_.getByText('Reading the library…')).toHaveCount(0, { timeout: 60_000 });

    // The X-ray: measured from the audio, so the numbers have to be the fixture's.
    await expect(window_.locator('.library-findings li').first()).toContainText('of music');
    await expect(window_.locator('.library-bars .library-bar')).toHaveCount(14);
    await expect(window_.locator('.library-wheel path')).toHaveCount(24);

    // The duplicate: two files whose names, sizes and tags share nothing.
    const group = window_.locator('.library-groups > li');
    await expect(group).toHaveCount(1);
    await expect(group).toContainText(library.duplicates[0].replace(/\.wav$/, ''));
    await expect(group).toContainText('anonymous-rip');

    await window_.getByRole('button', { name: 'Close' }).click();
    await expect(window_).toHaveCount(0);

    // Every visit after the first: the library is in IndexedDB and no folder has
    // been reconnected. The window has to work anyway, because what it needs is
    // analysed tracks and not a folder picker somebody used once.
    await page.reload();
    await expect(page.locator('#main-window')).toBeVisible();
    await expect(page.locator('.vibe-count')).toHaveText(`${library.tracks.length} analysed`);
    await page.locator('.vibe-window').getByRole('button', { name: 'X-ray' }).click();
    await expect(window_.getByText('Reading the library…')).toHaveCount(0, { timeout: 60_000 });
    await expect(window_.locator('.library-groups > li')).toHaveCount(1);
  } finally {
    rmSync(library.dir, { recursive: true, force: true });
  }
});
