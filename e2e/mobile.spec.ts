import { expect, test } from '@playwright/test';

/**
 * The phone layout.
 *
 * What it is for: the vibe panel used to open on top of the main window on a phone,
 * covering the transport, and the page could not scroll. The app was unusable and
 * looked broken, which nothing in the desktop suite could see.
 *
 * These run in the same browser as the rest, at a phone's viewport. That is enough
 * to catch a layout that overlaps, overflows or cannot be reached; it is not a
 * claim about iOS, which has its own limits and is documented rather than tested.
 */

test.use({ viewport: { width: 390, height: 664 } });

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#main-window')).toBeVisible();
});

test('stacks the shell and the panel in one column', async ({ page }) => {
  const main = await page.locator('#main-window').boundingBox();
  const playlist = await page.locator('#playlist-window').boundingBox();
  const vibe = await page.locator('.vibe-window').boundingBox();
  expect(main).not.toBeNull();
  expect(playlist).not.toBeNull();
  expect(vibe).not.toBeNull();

  // Top to bottom, in that order, each docked onto the one above with no gap:
  // three windows of one instrument, not a player with a card underneath it.
  expect(playlist!.y).toBeCloseTo(main!.y + main!.height, 0);
  expect(vibe!.y).toBeCloseTo(playlist!.y + playlist!.height, 0);

  // Same width and the same left edge, so the column has one straight side.
  // Within a pixel, not to the pixel: Webamp rounds its own centring and CSS
  // margins do not, so on an odd number of spare pixels the two differ by a half.
  expect(vibe!.width).toBeCloseTo(main!.width, 0);
  expect(Math.abs(vibe!.x - main!.x)).toBeLessThanOrEqual(1);
});

test('leaves the equaliser closed, and one tap away', async ({ page }) => {
  // Ten bands at 275px is a row of targets nobody can hit, and it costs a third of
  // the screen before the player has said what is playing.
  await expect(page.locator('#equalizer-window')).toHaveCount(0);

  await page.locator('#option').click({ force: true });
  await expect(page.locator('li', { hasText: /^Equalizer$/ }).first()).toBeVisible();
});

test('fits the width and scrolls to the whole panel', async ({ page }) => {
  const viewport = page.viewportSize();
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    scrollHeight: document.documentElement.scrollHeight,
  }));
  const vibe = await page.locator('.vibe-window').boundingBox();

  expect(metrics.scrollWidth).toBeLessThanOrEqual(viewport!.width);
  // The regression: the panel was positioned absolutely and the page did not grow
  // to hold it, so its last rows could not be scrolled to at all.
  expect(metrics.scrollHeight).toBeGreaterThanOrEqual(vibe!.y + vibe!.height);
});

test('gives the controls something a thumb can hit', async ({ page }) => {
  const vibe = page.locator('.vibe-window');

  for (const name of ['Milkdrop', 'Skin', 'Export', 'Import']) {
    const box = await vibe.getByRole('button', { name, exact: true }).boundingBox();
    expect(box).not.toBeNull();
    // Apple's own floor for a touch target is 44pt; 32 CSS px is the compromise
    // this window's density allows, and it is more than double what it had.
    expect(box!.height).toBeGreaterThanOrEqual(32);
  }

  const fader = await vibe.locator('input[type=range]').first().boundingBox();
  expect(fader!.height).toBeGreaterThanOrEqual(100);
  expect(fader!.width).toBeGreaterThanOrEqual(24);
});

test('does not drag the panel when the page is scrolled', async ({ page }) => {
  // The title bar is a drag handle on a desktop. On a phone the same gesture is a
  // scroll, and the two used to fight over it.
  const before = await page.locator('.vibe-window').boundingBox();
  const title = page.locator('.vibe-titlebar');

  await title.hover();
  await page.mouse.down();
  await page.mouse.move(40, 400, { steps: 8 });
  await page.mouse.up();

  const after = await page.locator('.vibe-window').boundingBox();
  expect(after!.x).toBe(before!.x);
  expect(after!.y).toBe(before!.y);
});
