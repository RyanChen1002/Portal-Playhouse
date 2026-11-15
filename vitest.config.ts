import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['{shared,scripts}/**/*.test.ts'],
          exclude: ['**/node_modules/**', '**/*.integration.test.ts'],
        },
      },
      {
        test: {
          name: 'integration',
          include: ['{shared,scripts}/**/*.integration.test.ts'],
          exclude: ['**/node_modules/**'],
          fileParallelism: false,
        },
      },
    ],
  },
});
