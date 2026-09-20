import { expect, test } from '@playwright/test';
import { EQ_BANDS } from '../apps/web/src/audio/eq.js';

/**
 * What can only be checked in a browser.
 *
 * The unit tests cover the descriptors and the queue. These cover the seam with
 * Webamp, which is the part that breaks without anything failing to compile: the
 * shell mounting itself at the end of `<body>`, our windows landing where the shell
 * is not, and our keyboard shortcuts fighting Winamp's.
 */

/** The main window's real size, in CSS pixels. Double size makes it 550. */
const MAIN_WINDOW_WIDTH = 275;

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  // The shell parses its skin before it renders anything.
  await expect(page.locator('#main-window')).toBeVisible();
});

test('renders the Winamp shell with all three windows', async ({ page }) => {
  await expect(page.locator('#main-window')).toBeVisible();
  await expect(page.locator('#equalizer-window')).toBeVisible();
  await expect(page.locator('#playlist-window')).toBeVisible();
});

test('gives every band our audio engine filters a slider in the shell', async ({ page }) => {
  // The strongest assertion available for this seam: the shell names each slider
  // `#band-<hz>`, so this checks the frequencies it draws are exactly the ones we
  // build BiquadFilterNodes for. The band labels themselves are sprites from the
  // skin, not text, so there is nothing to read there. If the two ever diverge, a
  // slider silently moves a frequency nothing is filtering.
  for (const frequency of EQ_BANDS) {
    await expect(page.locator(`#band-${frequency}`)).toHaveCount(1);
  }
  await expect(page.locator('#equalizer-window #preamp')).toHaveCount(1);
});

test('shows the vibe window on screen, not behind or below the shell', async ({ page }) => {
  // It is a sibling of a full-height element, and Webamp mounts itself at the end
  // of <body> with its own stacking context: both have put this window somewhere
  // the user could not see it.
  const vibe = page.locator('.vibe-window');
  await expect(vibe).toBeVisible();
  await expect(vibe.locator('input[type=range]')).toHaveCount(5);

  const box = await vibe.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height);
  expect(box!.x).toBeGreaterThanOrEqual(0);
});

test('disables the auto-DJ until there is enough analysed, and says why', async ({ page }) => {
  const vibe = page.locator('.vibe-window');
  await expect(vibe).toContainText('Auto-DJ needs 30 analysed tracks');
  await expect(vibe.locator('input[type=range]').first()).toBeDisabled();
});

test('offers the library actions', async ({ page }) => {
  const vibe = page.locator('.vibe-window');
  await expect(vibe.getByRole('button', { name: 'Skin…' })).toBeVisible();
  await expect(vibe.getByRole('button', { name: 'Export' })).toBeVisible();
  await expect(vibe.getByRole('button', { name: 'Import' })).toBeVisible();
});

test('toggles the debug panel without resizing the player', async ({ page }) => {
  // The regression this exists for: Winamp binds Ctrl+D to double size and the
  // shell matches it without looking at Shift, so Ctrl+Shift+D opened the panel
  // and doubled the player at the same time.
  const main = page.locator('#main-window');
  const panel = page.locator('.debug-panel');

  await expect(panel).toHaveCount(0);
  const before = await main.boundingBox();
  expect(before?.width).toBe(MAIN_WINDOW_WIDTH);

  await page.keyboard.press('Control+Shift+KeyD');
  await expect(panel).toBeVisible();
  expect((await main.boundingBox())?.width).toBe(MAIN_WINDOW_WIDTH);

  await page.keyboard.press('Control+Shift+KeyD');
  await expect(panel).toHaveCount(0);
  expect((await main.boundingBox())?.width).toBe(MAIN_WINDOW_WIDTH);
});

test('the debug panel reports the analysis state', async ({ page }) => {
  await page.keyboard.press('Control+Shift+KeyD');
  const panel = page.locator('.debug-panel');

  await expect(panel).toContainText('Stages');
  await expect(panel).toContainText('Now playing');
  await expect(panel).toContainText('Failures');
  await expect(panel).toContainText('nothing analysed yet');
});

test('registers a service worker, so it can start with no network', async ({ page }) => {
  // Acceptance criterion 12. This proves the worker registers and precaches; that
  // it then starts offline is a separate thing to check by hand.
  await expect(page.locator('.offline-notice')).toContainText('Ready to run offline', {
    timeout: 15_000,
  });
});

test('raises no console errors on a cold load', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));

  await page.reload();
  await expect(page.locator('#main-window')).toBeVisible();
  await page.waitForTimeout(1500);

  expect(errors).toEqual([]);
});
