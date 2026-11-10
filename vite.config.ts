import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Identificador de la versión publicada (fecha y hora de la compilación, hora peninsular).
const BUILD = new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Madrid' }).slice(0, 16);

// SINGLE=1 genera un único index.html autocontenido (útil para compartir o publicar).
export default defineConfig({
  plugins: [
    react(),
    ...(process.env.SINGLE ? [viteSingleFile()] : []),
    {
      // version.json: la app lo consulta al abrirse para saber si hay una versión más nueva
      name: 'version-json',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build: BUILD }) });
      },
    },
  ],
  define: { __BUILD__: JSON.stringify(BUILD) },
  base: './',
  build: { chunkSizeWarningLimit: 3000 },
});
