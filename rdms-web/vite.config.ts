import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // The backend is the Java API (unirise-api). In development the browser reaches it through this proxy, so pages and
  // API share one origin, as on a server. API defaults to a local unirise-api on port 8181 (see README).
  server: { port: 5180, proxy: { '/api': process.env.API ?? 'http://127.0.0.1:8181' } },
});
