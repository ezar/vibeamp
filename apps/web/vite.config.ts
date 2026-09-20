import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * The app is served from the root on Vercel and from a subdirectory on GitHub
 * Pages, so the base is a build input rather than a constant.
 */
const base = process.env.BASE_PATH ?? '/';

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'vibeamp',
        short_name: 'vibeamp',
        description:
          'A local-first music player with a real Winamp shell and a recommendation engine that listens to your own files.',
        theme_color: '#1b1b22',
        background_color: '#1b1b22',
        display: 'standalone',
        start_url: base,
        // One scalable icon rather than a ladder of PNGs. Chromium accepts an SVG
        // with `sizes: 'any'` for installability, and there is nothing in this mark
        // that benefits from being rasterised at five sizes.
        icons: [
          {
            src: `${base}icon.svg`,
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        // The shell and the analysis worker are the whole app; there is nothing to
        // fetch at runtime, which is what lets it start with no network at all.
        globPatterns: ['**/*.{js,css,html,png,svg,woff2}'],
      },
    }),
  ],
  worker: {
    // The analysis worker imports the workspace packages, so it has to be a module
    // worker rather than a classic one.
    format: 'es',
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
