/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Monorepo: contract tests read the shared schemas/OpenAPI in <repo>/docs (and fixtures in
    // <repo>/fixtures). Allow exactly those besides this app.
    fs: { allow: ['.', '../../docs', '../../fixtures'] },
  },
  build: {
    // The ELK layout engine is ~1.5 MB minified; it ships as a Web Worker (plus a bundled fallback
    // chunk used only without Worker support). App chunks stay well below this limit.
    chunkSizeWarningLimit: 1600,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: true,
  },
});
