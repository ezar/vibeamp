import { expect, test } from '@playwright/test';
import { rmSync } from 'node:fs';

import { writeBandwidthLibrary } from './fixtures/library.js';

/**
 * The second decode: the one check the ordinary analysis cannot make.
 *
 * The analysis runs at 16 kHz, so its ceiling is 8 kHz and every file in this
 * fixture looks identical to it. Only a decode at the file's own rate can tell
 * them apart, which is the whole reason this exists as a button rather than as
 * part of the pipeline.
 *
 * What it must report is the *disagreement*, not the cutoff: all three files here
 * carry a lossless file's worth of bytes, so the one with a 16 kHz ceiling is a
 * transcode and the one with its whole top end is not.
 */

test('reads what the 16 kHz analysis cannot', async ({ page }) => {
  const library = writeBandwidthLibrary();
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

    // Offered, not run: it costs a full-rate decode of every file.
    const deep = window_.locator('.library-deep');
    await expect(deep).toContainText('Decodes every file again at full rate');
    await expect(deep.locator('.library-issues')).toHaveCount(0);

    await deep.getByRole('button', { name: 'Deep check' }).click();
    await expect(deep).toContainText(`Read ${library.tracks.length} files.`, { timeout: 180_000 });

    const group = (name: string) =>
      deep.locator('.library-issues > li').filter({ has: page.getByText(name, { exact: true }) });

    // The disagreement, and only it: same bytes, less bandwidth.
    await expect(group('transcoded')).toContainText(library.transcoded.replace('.wav', ''));
    // The edge is reported to the band it falls in, so the exact tenth is the
    // measure's resolution rather than a claim about the file.
    await expect(group('transcoded')).toContainText(/cuts off at 16\.\d kHz/);
    await expect(group('transcoded')).not.toContainText(library.full.replace('.wav', ''));

    await expect(group('full band')).toContainText(library.full.replace('.wav', ''));
  } finally {
    rmSync(library.dir, { recursive: true, force: true });
  }
});
