import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['test/global-setup.ts'],
    // Integration tests share one real Postgres database, so files run one at a time.
    fileParallelism: false,
    testTimeout: 15_000,
  },
});
