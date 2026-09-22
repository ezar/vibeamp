import { expect, test } from '@playwright/test';
import { readFileSync, rmSync } from 'node:fs';

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

  // Both halves of a row in one evaluation, not two awaits.
  //
  // The queue re-renders whenever the plan changes, and these fixture tracks are
  // ten seconds long, so one finishing between reading a row's title and reading
  // its tempo pairs the name of one track with the number of another. That failed
  // about one full-suite run in three and looked like a bad measurement, which it
  // never was: every fixture tempo reads back to within half a BPM.
  const pairs = await rows.evaluateAll((items) =>
    items.map((item) => ({
      title: item.querySelector('.vibe-queue-title')?.textContent ?? '',
      meta: item.querySelector('.vibe-queue-meta')?.textContent ?? '',
    })),
  );

  for (const { title, meta } of pairs) {
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

test('writes the set out as one file that plays and reads', async ({ page }) => {
  // The plan lives in memory and dies with the tab. This is the only way the part
  // that took the work — the order — leaves the browser.
  const vibe = page.locator('.vibe-window');

  // Nothing to save until the auto-DJ has planned something.
  await expect(vibe.getByRole('button', { name: 'Set', exact: true })).toBeDisabled();
  await vibe.getByRole('button', { name: 'AUTO-DJ' }).click();
  await expect(vibe.locator('.vibe-queue li').first()).toBeVisible({ timeout: 30_000 });

  const download = page.waitForEvent('download');
  await vibe.getByRole('button', { name: 'Set', exact: true }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^vibeamp-set-\d{4}-\d{2}-\d{2}\.m3u$/);

  const text = readFileSync(await file.path(), 'utf8');
  const lines = text.split('\n');

  expect(lines[0]).toBe('#EXTM3U');
  expect(lines[1]).toMatch(/^# vibeamp set · \d{4}-\d{2}-\d{2} · \d+ tracks$/);

  // Every path in it is a real file of the library, and every note describes the
  // move into the track below it rather than floating free.
  //
  // Paths are written relative to the library root, as "Save list" writes them, so
  // they carry the folder the picker reported and are matched on their last part.
  const paths = lines.filter((line) => line !== '' && !line.startsWith('#'));
  expect(paths.length).toBeGreaterThan(1);
  for (const path of paths) {
    const name = path.slice(path.lastIndexOf('/') + 1);
    expect(library.tracks.some((track) => track.fileName === name)).toBe(true);
  }

  const notes = lines.filter((line) => line.startsWith('# ↓'));
  expect(notes.length).toBe(paths.length - 1);
  for (const note of notes) expect(note).toMatch(/bpm/);
});
