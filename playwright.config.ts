import { defineConfig, devices } from '@playwright/test';

/**
 * End to end tests run against a production build, because that is what the
 * service worker and the bundled shell behave like. Several of the things worth
 * asserting — the shell rendering at all, a hotkey not colliding with Winamp's —
 * only exist once Webamp is on a real page.
 */

/** The app is served from the root on Vercel and from a subdirectory on Pages. */
const basePath = process.env.BASE_PATH ?? '/';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://127.0.0.1:4173${basePath}`,
    trace: 'on-first-retry',
    // Honour a preinstalled browser where the environment provides one.
    ...(process.env.CHROMIUM_PATH
      ? { launchOptions: { executablePath: process.env.CHROMIUM_PATH } }
      : {}),
  },
  projects: [
    {
      // Desktop Chromium is the target platform: it is the one with the File
      // System Access API, and the one the window layout is designed for.
      name: 'desktop',
      use: {
        ...devices['Desktop Chrome'],
        ...(process.env.CHROMIUM_PATH
          ? { launchOptions: { executablePath: process.env.CHROMIUM_PATH } }
          : {}),
      },
    },
  ],
  webServer: {
    // Built here rather than trusting whatever is in `dist`. The base path is a
    // build input, so a server left over from a run at a different base looks
    // healthy, answers every request and fails every asset.
    //
    // `--host 127.0.0.1` is load-bearing. Without it `vite preview` binds whatever
    // `localhost` resolves to, which is IPv6 `::1` first on a GitHub runner, while
    // the check below polls IPv4. The build then succeeds, nothing is logged, and
    // the run dies on the web server timeout three minutes later.
    command:
      'pnpm --filter @vibeamp/web build && pnpm --filter @vibeamp/web preview --port 4173 --strictPort --host 127.0.0.1',
    url: `http://127.0.0.1:4173${basePath}`,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
