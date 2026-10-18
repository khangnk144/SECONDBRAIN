import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The server runs this config in Vite middleware mode for `npm run dev`,
// so no dev server port/host is configured here.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // Never inline assets as data: URIs (fonts must come from 'self' under the CSP).
    assetsInlineLimit: 0,
    sourcemap: false,
  },
});
