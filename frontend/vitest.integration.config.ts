import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/backend.integration.test.ts'],
    fileParallelism: false,
    hookTimeout: 30_000,
    testTimeout: 30_000,
  },
});
