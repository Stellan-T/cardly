/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import { APP_DESCRIPTION, APP_NAME, STORAGE_PREFIX, THEME_COLOR, THEME_COLOR_DARK } from './src/config/app.ts'

export default defineConfig(({ mode }) => {
  // GitHub Pages serves a project site from /<repo-name>/. The deploy workflow sets
  // VITE_BASE (or put it in .env.local); otherwise it is /cardly/.
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  const base = process.env.VITE_BASE || env.VITE_BASE || '/cardly/'
  return {
    base,
    plugins: [
      {
        name: 'app-identity',
        transformIndexHtml: (html) =>
          html
            .replaceAll('%APP_NAME%', APP_NAME)
            .replaceAll('%APP_DESCRIPTION%', APP_DESCRIPTION)
            .replaceAll('%STORAGE_PREFIX%', STORAGE_PREFIX)
            .replaceAll('%THEME_COLOR%', THEME_COLOR)
            .replaceAll('%THEME_COLOR_DARK%', THEME_COLOR_DARK),
      },
      react(),
      VitePWA({
        registerType: 'prompt',
        injectRegister: false,
        includeAssets: ['favicon.ico', 'favicon.svg', 'apple-touch-icon-180x180.png', 'logo.svg'],
        manifest: {
          name: APP_NAME,
          short_name: APP_NAME,
          description: APP_DESCRIPTION,
          lang: 'en',
          start_url: '.',
          scope: '.',
          display: 'standalone',
          orientation: 'any',
          background_color: '#f7f6f2',
          theme_color: THEME_COLOR,
          categories: ['education', 'productivity'],
          icons: [
            { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
            { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
            { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
            { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,mjs,css,html,svg,png,ico,webmanifest,woff2}'],
          // The PDF.js worker is large; precache it so file import works offline.
          maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
          navigateFallback: 'index.html',
          cleanupOutdatedCaches: true,
        },
        devOptions: { enabled: false },
      }),
    ],
    build: {
      target: 'es2022',
      chunkSizeWarningLimit: 1200,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules/firebase') || id.includes('node_modules/@firebase')) return 'firebase'
            if (id.includes('node_modules/react') || id.includes('node_modules/scheduler')) return 'react'
            return undefined
          },
        },
      },
    },
    test: {
      environment: 'jsdom',
      globals: false,
      setupFiles: ['./src/test/setup.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
      css: false,
    },
  }
})
