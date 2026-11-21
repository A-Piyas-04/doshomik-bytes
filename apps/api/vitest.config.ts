import { defineConfig } from 'vitest/config';
import { TEST_ENV } from './test/env.ts';

export default defineConfig({
  test: {
    env: TEST_ENV,
    globalSetup: './test/global-setup.ts',
    fileParallelism: false, // test files share one database
  },
});
