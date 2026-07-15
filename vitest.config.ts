import { defineConfig } from 'vitest/config';

// Vitest config kept separate from vite.config.ts so tests don't load the
// CRXJS plugin (which expects a full extension build context).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    globals: false,
  },
});
