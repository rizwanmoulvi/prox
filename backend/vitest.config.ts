import { defineConfig } from 'vitest/config'

// LIVE=1 runs only the tests that call the real Backpack API.
const live = process.env.LIVE === '1'

export default defineConfig({
  test: {
    include: live ? ['test/live/**/*.test.ts'] : ['test/**/*.test.ts'],
    exclude: live ? [] : ['test/live/**'],
    testTimeout: live ? 30_000 : 5_000,
    fileParallelism: !live,
  },
})
