import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev: proxy /api to the backend so the client never hardcodes a host/port.
// Prod: the backend serves the built web app from the same origin, so /api is relative.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: process.env.HATCH_API || 'http://localhost:8787', changeOrigin: true },
    },
  },
  build: { outDir: 'dist' },
});
