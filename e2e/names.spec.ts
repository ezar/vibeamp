import { expect, test } from '@playwright/test';
import { rmSync } from 'node:fs';

import { writeUnnamedLibrary } from './fixtures/library.js';

/**
 * Naming the files that have none, and then finding them with somebody's list.
 *
 * The two features are tested together because that is how they are worth
 * anything. On its own, a want list matches tags; behind the naming pass it matches
 * a file whose only evidence of identity is its sound, which is the thing no
 * tag-driven tool and no streaming service can do.
 *
 * Everything here goes through the real worker pool against a real folder. The
 * borrowed name in particular is only a claim about the audio: the two files share
 * no name, no size and no date.
 */
test('names the files that have none, then finds them with a pasted list', async ({ page }) => {
  const library = writeUnnamedLibrary();
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

    const names = window_.locator('.library-section', { hasText: 'NAMES' });
    const rows = names.locator('.library-names > li');

    // The one that needed the audio: an untagged re-encode matched to the tagged
    // copy of the same recording, and named after it.
    const heard = rows.filter({ hasText: library.bySound });
    await expect(heard).toHaveCount(1);
    await expect(heard).toContainText('by sound');
    await expect(heard).toContainText(`${library.donor.artist} — ${library.donor.title}`);

    // The ordinary untagged rip, whose artist was typed once into a folder name.
    const read = rows.filter({ hasText: library.byFolder.fileName });
    await expect(read).toContainText('by folder');
    await expect(read).toContainText(`${library.byFolder.artist} — ${library.byFolder.title}`);

    // A loose file whose path says nothing gets no proposal: a suggestion
    // identical to what is already on screen is noise.
    await expect(rows).toHaveCount(2);

    await names.getByRole('button', { name: /^Accept/ }).click();
    await expect(page.locator('.vibe-status')).toContainText('Named 2 files.');
    await expect(window_.getByText('Reading the library…')).toHaveCount(0, { timeout: 60_000 });
    await expect(window_.locator('.library-names > li')).toHaveCount(0);

    // Now the list. Two of these three are on the shelf, and one of the two is
    // only findable because of what the analysis heard.
    const want = window_.locator('.library-section', { hasText: 'WANT LIST' });
    await want
      .getByLabel('Want list', { exact: true })
      .fill(
        `${library.byFolder.artist} – ${library.byFolder.title}\n` +
          `${library.donor.artist} – ${library.donor.title}\n` +
          'Wire – Ex Lion Tamer',
      );
    await want.getByRole('button', { name: 'Match' }).click();

    await expect(want.locator('.library-findings li').first()).toHaveText(
      '2 of 3 are already on the shelf.',
    );
    const missing = want.locator('.library-want-column', { hasText: 'not here' });
    await expect(missing.locator('li')).toHaveCount(1);
    await expect(missing).toContainText('Wire – Ex Lion Tamer');

    const owned = want.locator('.library-want-column', { hasText: 'on the shelf' });
    await expect(owned.locator('li')).toHaveCount(2);

    // Nothing in the report claims to know what the missing record sounds like.
    await expect(missing).not.toContainText('BPM');

    // The whole of the undo: the tags were never touched.
    await names.getByRole('button', { name: /^Forget/ }).click();
    await expect(page.locator('.vibe-status')).toContainText('Forgot 2 names.');
    await expect(window_.getByText('Reading the library…')).toHaveCount(0, { timeout: 60_000 });
    await expect(window_.locator('.library-names > li')).toHaveCount(2);
  } finally {
    rmSync(library.dir, { recursive: true, force: true });
  }
});
