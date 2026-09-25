import { expect, test } from '@playwright/test';
import { rmSync } from 'node:fs';

import { writeSegueLibrary } from './fixtures/library.js';

/**
 * The tracks a record does not stop between.
 *
 * Against a real folder analysed by the real worker pool, because the claim is
 * entirely about the audio at the two ends: nothing in the names, the tags or the
 * sizes distinguishes the one pair that runs together from the three that do not.
 */
test('finds the one pair that runs together, and none of the three that do not', async ({
  page,
}) => {
  const library = writeSegueLibrary();
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

    const section = window_.locator('.library-section--segues');
    const rows = section.locator('.library-segues > li');
    await expect(rows).toHaveCount(1);

    const [from, to] = library.join;
    await expect(rows.first()).toContainText(from.replace(/\.wav$/, ''));
    await expect(rows.first()).toContainText(to.replace(/\.wav$/, ''));

    // The three that must not be here: a track that fades out before the next, a
    // track that fades in after one ending at full level, and a record in another
    // folder whose numbering happens to continue.
    await expect(section).not.toContainText('01 opens');
    await expect(section).not.toContainText('04 fades in');
    await expect(section).not.toContainText('05 elsewhere');

    // Stated whatever was found: this is read off the two ends, not off the tags.
    await expect(section).toContainText('not off the tags');
  } finally {
    rmSync(library.dir, { recursive: true, force: true });
  }
});
