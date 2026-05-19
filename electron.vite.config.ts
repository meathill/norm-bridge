import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));

const sharedAlias = {
  '@shared': resolve(root, 'src/shared'),
};

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        ...sharedAlias,
        '@main': resolve(root, 'src/main'),
        '@agents': resolve(root, 'agents'),
      },
    },
    build: {
      outDir: 'out/main',
      rollupOptions: {
        input: {
          index: resolve(root, 'src/main/index.ts'),
        },
        external: ['electron', /^electron\/.+/],
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: sharedAlias,
    },
    build: {
      outDir: 'out/preload',
      rollupOptions: {
        input: {
          index: resolve(root, 'src/preload/index.ts'),
        },
        external: ['electron', /^electron\/.+/],
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs',
        },
      },
    },
  },
  renderer: {
    root: resolve(root, 'src/renderer'),
    base: './',
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        ...sharedAlias,
        '@': resolve(root, 'src/renderer'),
      },
    },
    build: {
      outDir: resolve(root, 'out/renderer'),
      rollupOptions: {
        input: {
          index: resolve(root, 'src/renderer/index.html'),
        },
      },
    },
  },
});
