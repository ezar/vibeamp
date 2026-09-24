import { expect, test } from '@playwright/test';
import { rmSync } from 'node:fs';

import { writeUnhealthyLibrary } from './fixtures/library.js';

/**
 * The condition report, against files that are really broken.
 *
 * Every defect in the fixture is one that no tag records: a mono recording in a
 * stereo container, a download that stopped early, a master driven into the
 * ceiling, a rip that produced silence. The point of running it end to end is that
 * each of those has to survive decoding in a real browser — and one of them,
 * the stereo check, is measured in the only place the two channels still exist.
 *
 * The fixture also contains two files built to look broken and not be. Those are
 * the assertions that matter: a report that flags a loud master as clipped, or a
 * club track that stops on the beat as truncated, is worse than no report.
 */

test('finds the defects in the files and leaves the healthy ones alone', async ({ page }) => {
  const library = writeUnhealthyLibrary();
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
      timeout: 300_000,
    });

    await page.locator('.vibe-window').getByRole('button', { name: 'X-ray' }).click();
    const window_ = page.locator('.library-window');
    await expect(window_.getByText('Reading the library…')).toHaveCount(0, { timeout: 120_000 });

    const condition = window_.locator('.library-section--condition');
    await expect(condition).toBeVisible();

    const issue = (name: string) =>
      condition
        .locator('.library-issues > li')
        .filter({ has: page.getByText(name, { exact: true }) });

    await expect(issue('fake stereo')).toContainText(
      library.defects.fakeStereo.replace('.wav', ''),
    );
    await expect(issue('ends abruptly')).toContainText(
      library.defects.truncated.replace('.wav', ''),
    );
    await expect(issue('clipped')).toContainText(library.defects.clipped.replace('.wav', ''));
    await expect(issue('empty')).toContainText(library.defects.silent.replace('.wav', ''));
    await expect(issue('silence at the ends')).toContainText(
      library.defects.padded.replace('.wav', ''),
    );

    // The two built to look broken. A loud master is not a clipped one, and a track
    // that stops on the beat is a genre rather than a truncated download.
    await expect(issue('clipped')).not.toContainText('loud-master');
    await expect(issue('fake stereo')).not.toContainText('healthy');
    // A fade is the end of the music, not silence after it.
    await expect(issue('silence at the ends')).not.toContainText('healthy');

    // Stated whether or not anything was found: a check that cannot see transcodes
    // must not let its silence be read as "no transcodes".
    await expect(condition.locator('.library-blind')).toContainText('16 kHz');
  } finally {
    rmSync(library.dir, { recursive: true, force: true });
  }
});
