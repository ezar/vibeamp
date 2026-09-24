import { expect, test } from '@playwright/test';
import { rmSync } from 'node:fs';

import { writeLibrary } from './fixtures/library.js';

/**
 * Two collections compared with nothing between them but a short code.
 *
 * Tested against the app's own code, pasted back into it: a library compared with
 * itself must come out as the same library, and the shared ground must then be the
 * whole of it. It is the one comparison whose right answer is known without a
 * second machine, and it exercises the entire path — measure, encode, decode,
 * compare, and pick the records that sit in the overlap.
 */
test('compares two collections through a code that carries no records', async ({ page }) => {
  const library = writeLibrary(8);
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

    const compare = window_.locator('.library-section--compare');
    const mine = await compare.getByLabel('Your shape code').inputValue();

    // Short enough to paste into a message, and carrying nothing but numbers.
    expect(mine).toHaveLength(57);
    expect(mine).toMatch(/^S1[A-Za-z0-9_-]+$/);

    // Anything that is not a code this version wrote is refused rather than
    // decoded into two plausible histograms nobody would question.
    await compare.getByLabel('Their shape code').fill('not-a-code');
    await compare.getByRole('button', { name: 'Compare' }).click();
    await expect(page.locator('.vibe-status')).toContainText('not a shape code');

    // The library against itself: the same curve, the same wheel.
    await compare.getByLabel('Their shape code').fill(mine);
    await compare.getByRole('button', { name: 'Compare' }).click();

    const overlaps = compare.locator('.library-overlap-value');
    await expect(overlaps.first()).toHaveText('100%');
    await expect(overlaps.last()).toHaveText('100%');
    await expect(compare.locator('.library-findings li').first()).toContainText(
      `Their ${library.tracks.length} against your ${library.tracks.length}`,
    );

    // And the shared ground is every record in it.
    const shared = compare.locator('.library-common');
    await expect(shared.locator('h4')).toContainText(`${library.tracks.length}`);
    await expect(shared.locator('ol li')).toHaveCount(library.tracks.length);

    const download = page.waitForEvent('download');
    await shared.getByRole('button', { name: 'Save .m3u' }).click();
    expect((await download).suggestedFilename()).toBe('vibeamp-common-ground.m3u');
  } finally {
    rmSync(library.dir, { recursive: true, force: true });
  }
});
