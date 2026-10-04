import { defineConfig } from 'vitest/config';

// Kept separate from vite.config.ts so unit tests never load the PWA plugin.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
