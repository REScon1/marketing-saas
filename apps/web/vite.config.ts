import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Režim `demo` = vše běží v prohlížeči (jádro + úložiště v paměti), výstup je jeden HTML soubor.
export default defineConfig(({ mode }) => ({
  plugins: mode === 'demo' ? [react(), viteSingleFile()] : [react()],
  define: { __DEMO__: JSON.stringify(mode === 'demo') },
  build: { outDir: mode === 'demo' ? 'dist-demo' : 'dist', target: 'es2022' },
  server: { port: 5173, proxy: { '/api': 'http://localhost:3001' } },
}));
