import { defineConfig, devices } from '@playwright/test'

// End-to-end smoke test against the Firebase emulators:
//   npm run test:e2e   (wraps `firebase emulators:exec --only auth,firestore "playwright test"`)
const PORT = 5199

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}/cardly/`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/cardly/`,
    reuseExistingServer: !process.env.CI,
    env: { VITE_USE_EMULATORS: 'true', VITE_BASE: '/cardly/' },
    timeout: 120_000,
  },
})
