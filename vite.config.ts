import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

const root = import.meta.dirname;

function licenseAssets(): Plugin {
  const files = [
    ['LICENSE', 'LICENSE'],
    ['NOTICE', 'NOTICE'],
    ['THIRD_PARTY_NOTICES.md', 'THIRD_PARTY_NOTICES.md'],
    ['licenses/three-MIT.txt', 'node_modules/three/LICENSE'],
    ['licenses/postprocessing-Zlib.txt', 'node_modules/postprocessing/LICENSE.md'],
    ['licenses/n8ao-CC0.txt', 'node_modules/n8ao/LICENSE'],
  ] as const;
  return {
    name: 'inkleaf-licenses',
    apply: 'build',
    generateBundle() {
      for (const [fileName, path] of files) {
        this.emitFile({ type: 'asset', fileName, source: readFileSync(resolve(root, path)) });
      }
      const vite = readFileSync(resolve(root, 'node_modules/vite/LICENSE.md'), 'utf8');
      const core = vite.split('# Licenses of bundled dependencies')[0];
      if (!core?.includes('MIT License')) throw new Error('Vite core license could not be identified.');
      this.emitFile({ type: 'asset', fileName: 'licenses/Vite-MIT.txt', source: core });
    },
  };
}

export default defineConfig({
  plugins: [licenseAssets()],
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
