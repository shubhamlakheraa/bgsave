import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.json' with { type: 'json' };

export default defineConfig({
  plugins: [react(), crx({ manifest })],
  server: {
    port: 5173,
    strictPort: true,
    hmr: {
      port: 5173,
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      // welcome.html isn't referenced from the manifest, but the background
      // opens it via chrome.tabs.create on first install — tell Rollup to
      // emit it so the URL actually resolves in the packaged extension.
      input: {
        welcome: 'welcome.html',
      },
    },
  },
});
