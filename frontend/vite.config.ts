import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Local only: the app talks to the backend on 127.0.0.1 through this proxy.
export default defineConfig({
  plugins: [react()],
  server: {
    host: 'localhost',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://127.0.0.1:4000', changeOrigin: false },
    },
  },
  // Serves the production build (npm run preview); reuses the /api proxy above.
  preview: {
    host: 'localhost',
    port: 4173,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://127.0.0.1:4000', changeOrigin: false },
    },
  },
});
