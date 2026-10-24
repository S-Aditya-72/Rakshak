import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Engine and contract tests live in ../../packages; web-side tests in src/.
export default defineConfig({
  test: {
    root: fileURLToPath(new URL('../..', import.meta.url)),
    include: ['packages/*/test/**/*.test.ts', 'apps/web/src/**/*.test.ts'],
    environment: 'node',
  },
});
