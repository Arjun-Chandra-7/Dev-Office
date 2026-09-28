import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const API = `http://127.0.0.1:${process.env.DEV_OFFICE_PORT ?? 4317}`;

export default defineConfig({
  root: 'web',
  plugins: [react()],
  build: { outDir: '../dist', emptyOutDir: true, chunkSizeWarningLimit: 2000 },
  server: {
    host: '127.0.0.1',
    port: Number(process.env.DEV_OFFICE_WEB_PORT ?? 5173),
    strictPort: true,
    proxy: {
      '/api': { target: API },
      '/ws': { target: API, ws: true },
    },
  },
});
