import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5280,
    strictPort: true,
    host: '127.0.0.1',
    // /brag capture writes frames and a Chrome profile here; don't reload on them.
    watch: { ignored: ['**/brag-output/**/frames/**', '**/brag-output/**/stills/**', '**/brag-output/**/chrome-profile/**', '**/brag-output/**/*.wav'] },
  },
});
