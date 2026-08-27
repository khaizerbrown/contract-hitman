import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    // In development the game server runs separately on 8787. This makes the
    // browser see one address for both, exactly as it will once deployed.
    proxy: {
      '/ws': {
        target: 'ws://127.0.0.1:8787',
        ws: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  test: {
    globals: true,
    include: ['src/**/*.test.ts'],
  },
});
