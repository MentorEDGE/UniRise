import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // The API runs separately (server/index.ts); in development the browser talks to it through this proxy.
  server: { port: 5180, proxy: { '/api': 'http://127.0.0.1:5190' } },
});
