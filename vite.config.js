import { defineConfig } from 'vite';

export default defineConfig({
  // Use relative paths so the built site works on any hosting provider
  base: './',
  build: {
    outDir: 'dist',
    // Inline the chapters.json for a single-bundle deployment
    assetsInlineLimit: 1024 * 1024, // 1MB — inline the JSON asset
  },
});
