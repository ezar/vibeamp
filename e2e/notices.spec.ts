import { expect, test } from '@playwright/test';

/**
 * The licence notices ship with the build.
 *
 * MIT and Apache-2.0 both ask that the copyright and permission notice travel with
 * the copies you distribute. A minified bundle is a copy, and the minifier strips
 * comments: before this existed, `dist/assets/*.js` contained not one copyright
 * line. The file is generated from the dependency tree at build time, so the only
 * way to know it is right is to fetch it from a real build.
 */

test('serves the third-party notices next to the app', async ({ page, baseURL }) => {
  const response = await page.request.get(new URL('THIRD-PARTY-NOTICES.txt', baseURL).href);

  expect(response.status()).toBe(200);
  const notices = await response.text();

  // The packages a reader would look for: the shell, the visualiser, its presets,
  // and the one dependency that is Apache-2.0 rather than MIT.
  for (const name of ['webamp', 'butterchurn', 'butterchurn-presets', 'dexie']) {
    expect(notices).toContain(name);
  }

  // Real licence text, not just a list of names.
  expect(notices).toContain('Permission is hereby granted, free of charge');
  expect(notices).toContain('Apache License');
  expect(notices.length).toBeGreaterThan(10_000);
});

test('links the notices from the page, so they can be found at all', async ({ page }) => {
  await page.goto('/');
  const href = await page.locator('link[rel=license]').getAttribute('href');

  expect(href).not.toBeNull();
  const response = await page.request.get(new URL(href!, page.url()).href);
  expect(response.status()).toBe(200);
});
