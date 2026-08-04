import { defineConfig } from 'vitest/config'

// Separate from vite.config.ts (which carries the PWA plugin etc. — irrelevant
// noise for unit tests). The outbox core (src/offline/*) is plain TypeScript
// with no DOM dependency, so a node environment + a fake IndexedDB is enough;
// see src/offline/test-setup.ts.
export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./src/offline/test-setup.ts'],
  },
})
