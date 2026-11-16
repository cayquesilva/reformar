/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Porta 5180 (strictPort) para não colidir com outros projetos Vite na porta padrão 5173.
const WEB_PORT = Number(process.env.WEB_PORT ?? 5180);
const API_URL = process.env.API_URL ?? 'http://localhost:3333';

export default defineConfig({
  plugins: [react()],
  server: {
    port: WEB_PORT,
    strictPort: true,
    proxy: {
      // Mesma origem no navegador: cookies httpOnly e proteção CSRF funcionam sem CORS.
      '/api': { target: API_URL, changeOrigin: false },
    },
  },
  build: {
    sourcemap: true,
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
  },
});
