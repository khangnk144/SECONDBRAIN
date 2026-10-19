import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    name: 'web',
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
    // The persistent module cache keys a file on its own content, so the translation index
    // (an import.meta.glob over locales/*.json) would keep serving a stale file list.
    fsModuleCache: false,
  },
});
