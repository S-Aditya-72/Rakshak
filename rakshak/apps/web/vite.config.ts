import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5280,
    strictPort: true,
    host: '127.0.0.1',
    // The local inference service (apps/server). Same-origin /api keeps tokens and CORS out of the browser.
    // ws: the device-sync relay (/api/sync) goes through the same proxy.
    proxy: { '/api': { target: process.env.RAKSHAK_API ?? 'http://127.0.0.1:8787', changeOrigin: false, ws: true, timeout: 300_000, proxyTimeout: 300_000 } },
    // /brag capture writes frames and a Chrome profile here, and Capacitor copies the build into android/;
    // don't reload on them.
    watch: { ignored: ['**/android/**', '**/brag-output/**/frames/**', '**/brag-output/**/stills/**', '**/brag-output/**/chrome-profile/**', '**/brag-output/**/*.wav'] },
  },
});
