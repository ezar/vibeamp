import { expect, test } from '@playwright/test';
import { rmSync } from 'node:fs';

import { writeLibrary } from './fixtures/library.js';

/**
 * Getting from one record to another.
 *
 * Driven against a real folder analysed by the real worker pool, because the whole
 * claim is about distances measured from the audio: a route is only worth anything
 * if the tempos and keys it was built from are the ones actually in the files.
 */
test('lays out a route from one record to another', async ({ page }) => {
  const library = writeLibrary(16);
  try {
    await page.addInitScript(() => {
      delete (window as { showDirectoryPicker?: unknown }).showDirectoryPicker;
    });

    await page.goto('/');
    await expect(page.locator('#main-window')).toBeVisible();

    const chooser = page.waitForEvent('filechooser');
    await page.locator('.vibe-window').getByRole('button', { name: 'OPEN FOLDER' }).click();
    await (await chooser).setFiles(library.dir);
    await expect(page.locator('.vibe-count')).toHaveText(`${library.tracks.length} analysed`, {
      timeout: 180_000,
    });

    await page.locator('.vibe-window').getByRole('button', { name: 'X-ray' }).click();
    const window_ = page.locator('.library-window');
    await expect(window_.getByText('Reading the library…')).toHaveCount(0, { timeout: 60_000 });

    const journey = window_.locator('.library-section--journey');
    await expect(journey).toBeVisible();

    // The two ends are the slowest and the fastest track the fixture wrote, named
    // the way the playlist names them.
    const slowest = library.tracks[0]?.fileName.replace(/\.wav$/, '') ?? '';
    const fastest = library.tracks[7]?.fileName.replace(/\.wav$/, '') ?? '';

    await journey.getByLabel('from', { exact: true }).fill(slowest);
    await journey.getByLabel('to', { exact: true }).fill(fastest);
    await journey.locator('#journey-steps').selectOption('4');
    await journey.getByRole('button', { name: 'Plan' }).click();

    const steps = journey.locator('.library-journey > li');
    await expect(steps).toHaveCount(6);
    await expect(steps.first()).toContainText(slowest);
    await expect(steps.last()).toContainText(fastest);

    // Every move but the first is explained, because a route is a list of
    // transitions as much as it is a list of records.
    await expect(steps.first().locator('.library-journey-move')).toHaveCount(0);
    await expect(steps.nth(1).locator('.library-journey-move')).toContainText('bpm');

    // Saving it writes a playlist that plays anywhere and reads as a route.
    const download = page.waitForEvent('download');
    await journey.getByRole('button', { name: 'Save .m3u' }).click();
    expect((await download).suggestedFilename()).toBe('vibeamp-journey.m3u');
  } finally {
    rmSync(library.dir, { recursive: true, force: true });
  }
});

test('says so rather than guessing when a name matches nothing', async ({ page }) => {
  const library = writeLibrary(16);
  try {
    await page.addInitScript(() => {
      delete (window as { showDirectoryPicker?: unknown }).showDirectoryPicker;
    });

    await page.goto('/');
    const chooser = page.waitForEvent('filechooser');
    await page.locator('.vibe-window').getByRole('button', { name: 'OPEN FOLDER' }).click();
    await (await chooser).setFiles(library.dir);
    await expect(page.locator('.vibe-count')).toHaveText(`${library.tracks.length} analysed`, {
      timeout: 180_000,
    });

    await page.locator('.vibe-window').getByRole('button', { name: 'X-ray' }).click();
    const window_ = page.locator('.library-window');
    await expect(window_.getByText('Reading the library…')).toHaveCount(0, { timeout: 60_000 });

    const journey = window_.locator('.library-section--journey');
    await journey.getByLabel('from', { exact: true }).fill('nothing called this');
    await journey.getByLabel('to', { exact: true }).fill('nor this');
    await journey.getByRole('button', { name: 'Plan' }).click();

    // A partial match that names several records is a question, not an answer:
    // picking one would send somebody where they did not ask to go.
    await expect(journey).toContainText('name one track');
    await expect(journey.locator('.library-journey > li')).toHaveCount(0);
  } finally {
    rmSync(library.dir, { recursive: true, force: true });
  }
});
