import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function readIconRev() {
  try {
    const match = /APP_ICON_REV = '([^']+)'/.exec(
      fs.readFileSync(path.resolve(__dirname, 'shared/iconRev.js'), 'utf8'),
    );
    return match?.[1] || '0';
  } catch {
    return '0';
  }
}

/**
 * No dev server and no port: `npm run build` emits the renderer to dist/, and
 * in dev the Electron main process runs this config in watch mode
 * (electron/devRenderer.js) into .dev-dist/.
 */
export default defineConfig({
  root: path.resolve(__dirname, 'src'),
  publicDir: path.resolve(__dirname, 'public'),
  base: './',
  plugins: [
    react(),
    {
      name: 'inject-icon-rev',
      transformIndexHtml(html) {
        return html.replaceAll('%APP_ICON_REV%', readIconRev());
      },
    },
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@shared': path.resolve(__dirname, 'shared'),
    },
  },
  build: {
    outDir: path.resolve(__dirname, 'dist'),
    emptyOutDir: true,
  },
});
