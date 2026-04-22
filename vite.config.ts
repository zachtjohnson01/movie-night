import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Inject build metadata as compile-time constants so we can render a
// visible build stamp in the app. Helps diagnose PWA cache staleness
// — you can look at the app and immediately tell which bundle your
// phone is actually running.
function resolveCommitSha(): string {
  if (process.env.VERCEL_GIT_COMMIT_SHA) {
    return process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 7);
  }
  try {
    return execSync('git rev-parse HEAD').toString().trim().slice(0, 7);
  } catch {
    return 'unknown';
  }
}

const BUILD_COMMIT = resolveCommitSha();
const BUILD_TIME = new Date().toISOString();

// https://vitejs.dev/config/
export default defineConfig({
  define: {
    __BUILD_COMMIT__: JSON.stringify(BUILD_COMMIT),
    __BUILD_TIME__: JSON.stringify(BUILD_TIME),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: [
        'favicon.svg',
        'apple-touch-icon.png',
        'icons/icon-192.png',
        'icons/icon-512.png',
      ],
      manifest: {
        name: 'Family Movie Night',
        short_name: 'Movie Night',
        description:
          'Track the family movie nights I watch with my daughter.',
        theme_color: '#0b0b0f',
        background_color: '#0b0b0f',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        icons: [
          {
            src: 'icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any maskable',
          },
          {
            src: 'icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        // Bumped cache id forces any PWA that still has an old service
        // worker to treat the new SW as a completely fresh install
        // instead of trying to reuse old cache entries. Effectively a
        // one-shot cache bust for anyone stuck on an old bundle.
        cacheId: 'movie-night-v2',
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        globPatterns: ['**/*.{js,css,html,svg,png,ico,json,webmanifest}'],
        navigateFallback: '/index.html',
        runtimeCaching: [
          {
            // OMDB posters are hosted on Amazon's CDN. Cache them
            // aggressively so they show up instantly on repeat loads
            // and survive offline (Friday-night flaky-wifi scenario).
            urlPattern: /^https:\/\/m\.media-amazon\.com\/images\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'movie-posters-v1',
              expiration: {
                maxEntries: 200,
                maxAgeSeconds: 60 * 60 * 24 * 90, // 90 days
              },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
});
