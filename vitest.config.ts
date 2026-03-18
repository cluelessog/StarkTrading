import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'url';
import { resolve } from 'path';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  test: {
    environment: 'node',
    exclude: ['**/node_modules/**', '**/.claude/**'],
    server: {
      deps: {
        // Ensure bun:sqlite require() calls also go through the alias
        inline: [/bun:sqlite/],
      },
    },
  },
  resolve: {
    alias: {
      'bun:sqlite': fileURLToPath(
        new URL('./packages/core/tests/__mocks__/bun-sqlite.ts', import.meta.url)
      ),
      'bun:test': fileURLToPath(
        new URL('./packages/core/tests/__mocks__/bun-test.ts', import.meta.url)
      ),
      '@stark/core': resolve(__dirname, 'packages/core/src'),
      '@stark/cli': resolve(__dirname, 'packages/cli/src'),
      '@stark/telegram': resolve(__dirname, 'packages/telegram/src'),
    },
  },
});
