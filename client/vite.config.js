import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';

// package.json has "type": "module" -> __dirname is not defined in ESM
const dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: dirname,
  plugins: [react()],
  build: {
    outDir: path.resolve(dirname, '../dist'),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:8080' },
  },
});
