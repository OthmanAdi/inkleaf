import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

const root = import.meta.dirname;

export default defineConfig({
  // Relative asset URLs, so the built site works from any folder, from a sub-path and from file://.
  base: './',
  server: { host: '127.0.0.1', port: 5280, strictPort: false },
  preview: { host: '127.0.0.1', port: 4280, strictPort: false },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 900,
    rolldownOptions: {
      input: {
        home: resolve(root, 'index.html'),
      },
      output: {
        codeSplitting: {
          groups: [
            // three.js and the post stack change only with their versions, so their files stay cached across releases.
            { name: 'three', test: /[\\/]node_modules[\\/]three[\\/]/, priority: 20 },
            { name: 'post', test: /[\\/]node_modules[\\/](postprocessing|n8ao)[\\/]/, priority: 15 },
          ],
        },
      },
    },
  },
  test: {
    environment: 'happy-dom',
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
    restoreMocks: true,
  },
});
