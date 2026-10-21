import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { serviceWorkerPlugin } from './vite-plugin-service-worker';

// The server runs this config in Vite middleware mode for `npm run dev`,
// so no dev server port/host is configured here.
export default defineConfig({
  plugins: [react(), serviceWorkerPlugin({ entry: 'src/pwa/service-worker.ts' })],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // Never inline assets as data: URIs (fonts must come from 'self' under the CSP).
    assetsInlineLimit: 0,
    sourcemap: false,
  },
});
