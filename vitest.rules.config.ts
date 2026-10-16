import { defineConfig } from 'vitest/config'

// Firestore security rules tests. They need the Firestore emulator:
//   npm run test:rules   (wraps `firebase emulators:exec --only firestore`)
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/rules/**/*.test.ts'],
    testTimeout: 20_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
})
