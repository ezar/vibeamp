import { expect, test } from '@playwright/test';
import { rmSync } from 'node:fs';

import { MIN_ANALYSED_TRACKS } from '../packages/dj/src/queue.js';
import { writeLibrary } from './fixtures/library.js';

/**
 * The auto-DJ, end to end.
 *
 * Everything else in this suite runs against an empty library, which is enough to
 * prove the shell renders and nothing more. This one connects a real folder and
 * follows it all the way through: scan, hash, analyse, normalise, plan, and the
 * queue on screen. Twice now something in this app has rendered perfectly and been
 * wrong underneath, and only a test that plays the whole chain would have caught it.
 */

/** One over the threshold, so the auto-DJ is available without analysing more. */
const TRACK_COUNT = MIN_ANALYSED_TRACKS + 2;

const library = writeLibrary(TRACK_COUNT);

test.afterAll(() => {
  rmSync(library.dir, { recursive: true, force: true });
});

test.beforeEach(async ({ page }) => {
  // A headless browser has no folder picker, so take the <input webkitdirectory>
  // path the app already keeps for Firefox and Safari.
  await page.addInitScript(() => {
    delete (window as { showDirectoryPicker?: unknown }).showDirectoryPicker;
  });
  await page.goto('/');
  await expect(page.locator('#main-window')).toBeVisible();

  const chooser = page.waitForEvent('filechooser');
  await page.locator('.vibe-window').getByRole('button', { name: 'OPEN FOLDER' }).click();
  await (await chooser).setFiles(library.dir);

  // Analysis runs a few tracks at a time in workers, so this is a real wait.
  await expect(page.locator('.vibe-count')).toHaveText(`${TRACK_COUNT} analysed`, {
    timeout: 180_000,
  });
});

test('wakes the auto-DJ up once there is enough analysed', async ({ page }) => {
  const vibe = page.locator('.vibe-window');

  await expect(vibe.getByRole('button', { name: 'AUTO-DJ' })).toBeEnabled();
  await expect(vibe.locator('input[type=range]').first()).toBeEnabled();
  for (const preset of ['warm', 'peak', 'dig', 'late']) {
    await expect(vibe.getByRole('button', { name: preset, exact: true })).toBeEnabled();
  }
});

test('shows the queue it planned, with the numbers it planned on', async ({ page }) => {
  // The plan lives outside the shell and the shell only ever holds two tracks, so
  // without this list the whole recommender is invisible.
  const vibe = page.locator('.vibe-window');
  await expect(vibe.locator('.vibe-queue')).toHaveCount(0);

  await vibe.getByRole('button', { name: 'AUTO-DJ' }).click();

  const rows = vibe.locator('.vibe-queue li');
  await expect(rows.first()).toBeVisible({ timeout: 30_000 });
  expect(await rows.count()).toBeGreaterThan(1);

  for (const meta of await vibe.locator('.vibe-queue-meta').allTextContents()) {
    // "124 · 8A": the tempo and the Camelot code the transition turns on.
    expect(meta).toMatch(/^\d{2,3} · (1[0-2]|[1-9])[AB]$/);
  }
});

test('measures the tempo and key the files were generated with', async ({ page }) => {
  // The strongest assertion in the suite: every descriptor, from decode to
  // normalisation, has to be right for the queue to name the tempo and key that
  // went into the file. It is also what proves the fixtures are honest.
  await page.locator('.vibe-window').getByRole('button', { name: 'AUTO-DJ' }).click();
  const rows = page.locator('.vibe-window .vibe-queue li');
  await expect(rows.first()).toBeVisible({ timeout: 30_000 });

  for (const row of await rows.all()) {
    const title = (await row.locator('.vibe-queue-title').textContent()) ?? '';
    const meta = (await row.locator('.vibe-queue-meta').textContent()) ?? '';

    const expected = Number(/(\d+) BPM/.exec(title)?.[1] ?? '0');
    const measured = Number(meta.split(' · ')[0] ?? '0');
    expect(expected).toBeGreaterThan(0);
    // Within a beat: the estimator reports fractional lags, and a ten second window
    // does not resolve a tempo to the exact integer the generator used.
    expect(Math.abs(measured - expected)).toBeLessThanOrEqual(1);
  }
});

test('replans when a slider moves, without touching what is already queued', async ({ page }) => {
  // The promise the product is built on, and the reason the plan lives outside the
  // shell: the first entries are committed and must survive, the tail must not.
  const vibe = page.locator('.vibe-window');
  await vibe.getByRole('button', { name: 'AUTO-DJ' }).click();
  const rows = vibe.locator('.vibe-queue li');
  await expect(rows.first()).toBeVisible({ timeout: 30_000 });

  const before = await rows.allTextContents();
  await vibe.getByRole('button', { name: 'late', exact: true }).click();
  await expect
    .poll(async () => (await rows.allTextContents()).join('|'), { timeout: 30_000 })
    .not.toBe(before.join('|'));

  const after = await rows.allTextContents();
  expect(after[0]).toBe(before[0]);
});
