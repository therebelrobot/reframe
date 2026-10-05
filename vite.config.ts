import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The client is served by the Hono server in production (same origin, strict CSP).
// In development, Vite proxies /api to the dev server so cookies stay same-origin.
export default defineConfig({
  root: 'client',
  plugins: [react()],
  build: {
    outDir: '../dist/public',
    emptyOutDir: true,
    // Keep every script and style as an external file: the production CSP
    // forbids inline scripts and inline <style> blocks.
    assetsInlineLimit: 0,
    sourcemap: false,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8787',
    },
  },
})
