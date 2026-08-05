import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    environmentMatchGlobs: [
      ['tests/use-animation-stream*.test.ts', 'jsdom'],
      ['tests/react/**/*.test.ts', 'jsdom'],
    ],
    include: ['tests/**/*.test.ts'],
  },
});
