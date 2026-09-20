import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
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

test('leads with the one thing that has to happen first', async ({ page }) => {
  // The regression this exists for: connecting a folder is the only way anything
  // else works, and the shell buries it three levels down its own menu. With no
  // visible entry point the app looks broken on arrival — nothing plays, nothing
  // analyses, and the auto-DJ sits at zero forever.
  const vibe = page.locator('.vibe-window');
  const open = vibe.getByRole('button', { name: 'OPEN FOLDER' });

  await expect(open).toBeVisible();
  await expect(open).toBeEnabled();
  await expect(vibe).toContainText('drop a folder on the player');
});

test('disables the auto-DJ until there is enough analysed', async ({ page }) => {
  const vibe = page.locator('.vibe-window');
  await expect(vibe.locator('input[type=range]').first()).toBeDisabled();
  await expect(vibe.getByRole('button', { name: 'AUTO-DJ' })).toBeDisabled();
});

test('offers the library actions', async ({ page }) => {
  const vibe = page.locator('.vibe-window');
  for (const name of ['Skin', 'Export', 'Import']) {
    await expect(vibe.getByRole('button', { name, exact: true })).toBeVisible();
  }
});

test('opens the vibe window beside the shell, not across the page from it', async ({ page }) => {
  // It used to open in the top-left corner while the shell centred itself, leaving
  // a screen-wide gap between the two halves of the same application.
  const vibe = await page.locator('.vibe-window').boundingBox();
  const shell = await page.locator('#main-window').boundingBox();
  expect(vibe).not.toBeNull();
  expect(shell).not.toBeNull();

  const gap = shell!.x - (vibe!.x + vibe!.width);
  expect(gap).toBeGreaterThanOrEqual(0);
  expect(gap).toBeLessThan(40);
  // Aligned tops, so they read as one window group.
  expect(Math.abs(vibe!.y - shell!.y)).toBeLessThan(4);
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

/**
 * Open one of the playlist window's bottom menus.
 *
 * The first click on an unfocused window only focuses it — Winamp's own behaviour,
 * which Webamp keeps — so opening a menu can take two.
 */
async function openPlaylistMenu(page: Page, id: string): Promise<void> {
  const menu = page.locator(`#${id}`);
  await menu.click();
  if ((await menu.getAttribute('class'))?.includes('selected') !== true) await menu.click();
  await expect(menu).toHaveClass(/selected/);
}

test('opens MilkDrop beside the player, not across the transport', async ({ page }) => {
  // The regression this exists for: with no layout of its own Webamp opens MilkDrop
  // at the same position as the main window, so the first thing the visualiser does
  // is hide the play button, the track title and the seek bar behind itself.
  await page.locator('.vibe-window').getByRole('button', { name: 'Milkdrop' }).click();

  const milkdrop = page.locator('.gen-window');
  await expect(milkdrop).toBeVisible({ timeout: 20_000 });
  // Butterchurn is fetched on demand, so the canvas arrives after the window.
  await expect(milkdrop.locator('canvas')).toBeVisible({ timeout: 20_000 });

  const visualiser = await milkdrop.boundingBox();
  const main = await page.locator('#main-window').boundingBox();
  const viewport = page.viewportSize();
  expect(visualiser).not.toBeNull();
  expect(main).not.toBeNull();

  const overlaps =
    visualiser!.x < main!.x + main!.width &&
    main!.x < visualiser!.x + visualiser!.width &&
    visualiser!.y < main!.y + main!.height &&
    main!.y < visualiser!.y + visualiser!.height;
  expect(overlaps).toBe(false);

  // Docked against the stack's right edge, the way Winamp's windows snap.
  expect(visualiser!.x).toBeCloseTo(main!.x + main!.width, 0);
  expect(visualiser!.y).toBeCloseTo(main!.y, 0);
  expect(visualiser!.x + visualiser!.width).toBeLessThanOrEqual(viewport!.width);
  expect(visualiser!.y + visualiser!.height).toBeLessThanOrEqual(viewport!.height);
});

test('offers MilkDrop where it can be found, and closes it again', async ({ page }) => {
  // The shell has its own entry for it, three levels into the Options menu and
  // closed on arrival, which is indistinguishable from not being there at all.
  const button = page.locator('.vibe-window').getByRole('button', { name: 'Milkdrop' });
  const milkdrop = page.locator('.gen-window');

  await expect(button).toBeVisible();
  await expect(milkdrop).toHaveCount(0);

  await button.click();
  await expect(milkdrop).toBeVisible({ timeout: 20_000 });

  await button.click();
  await expect(milkdrop).toHaveCount(0);
});

test('keeps every control of the vibe window inside it', async ({ page }) => {
  // The row that carries the button now holds six controls in 277 pixels.
  const vibe = await page.locator('.vibe-window').boundingBox();
  expect(vibe).not.toBeNull();

  for (const name of ['Skin', 'Export', 'Import', 'Milkdrop']) {
    const button = await page
      .locator('.vibe-window')
      .getByRole('button', { name, exact: true })
      .boundingBox();
    expect(button).not.toBeNull();
    expect(button!.x).toBeGreaterThanOrEqual(vibe!.x);
    expect(button!.x + button!.width).toBeLessThanOrEqual(vibe!.x + vibe!.width);
    expect(button!.y + button!.height).toBeLessThanOrEqual(vibe!.y + vibe!.height);
  }
});

test('answers the menu entries it does not support in its own words', async ({ page }) => {
  // The regression this exists for: five of the shell's menu entries fall back to a
  // browser alert reading "Not supported in Webamp", which names the wrong product
  // at somebody using this one. Three have handler options; two are hard-coded.
  const dialogs: string[] = [];
  page.on('dialog', async (dialog) => {
    dialogs.push(dialog.message());
    await dialog.dismiss();
  });
  const vibe = page.locator('.vibe-window');

  await openPlaylistMenu(page, 'playlist-add-menu');
  await page.locator('#playlist-add-menu .add-url').click();
  await expect(vibe).toContainText('nothing to fetch from a URL');

  await openPlaylistMenu(page, 'playlist-remove-menu');
  await page.locator('#playlist-remove-menu .remove-misc').click();
  await expect(vibe).toContainText('Remove misc is not part of vibeamp');

  await openPlaylistMenu(page, 'playlist-misc-menu');
  await page.locator('#playlist-misc-menu .file-info').click();
  await expect(vibe).toContainText('File info is not part of vibeamp');

  expect(dialogs).toEqual([]);
});

test('says what it did when asked to save an empty playlist', async ({ page }) => {
  const dialogs: string[] = [];
  page.on('dialog', async (dialog) => {
    dialogs.push(dialog.message());
    await dialog.dismiss();
  });

  await openPlaylistMenu(page, 'playlist-list-menu');
  await page.locator('#playlist-list-menu .save-list').click();

  await expect(page.locator('.vibe-window')).toContainText('nothing in the playlist to save');
  expect(dialogs).toEqual([]);
});

test('asks for a file when told to load a playlist', async ({ page }) => {
  const dialogs: string[] = [];
  page.on('dialog', async (dialog) => {
    dialogs.push(dialog.message());
    await dialog.dismiss();
  });

  await openPlaylistMenu(page, 'playlist-list-menu');
  const chooser = page.waitForEvent('filechooser');
  await page.locator('#playlist-list-menu .load-list').click();

  expect((await chooser).isMultiple()).toBe(false);
  expect(dialogs).toEqual([]);
});
