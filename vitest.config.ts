import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'url';

export default defineConfig({
  test: {
    environment: 'node',
  },
  resolve: {
    alias: {
      'bun:sqlite': fileURLToPath(
        new URL('./packages/core/tests/__mocks__/bun-sqlite.ts', import.meta.url)
      ),
    },
  },
});
