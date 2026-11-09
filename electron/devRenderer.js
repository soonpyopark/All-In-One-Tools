import fs from 'node:fs';
import path from 'node:path';

/**
 * Dev only: there is no dev server and no port. Vite builds the renderer into
 * `outDir` in watch mode and the window loads it from disk like a production
 * build; `onRebuilt` fires after every later rebuild so the window can reload.
 *
 * Resolves once the first build is on disk.
 *
 * @param {{ projectRoot: string, outDir: string, onRebuilt: () => void }} options
 * @returns {Promise<{ close: () => Promise<void> }>}
 */
export async function startDevRenderer({ projectRoot, outDir, onRebuilt }) {
  const { build } = await import('vite');
  let firstBuildDone = false;

  // Clean once up front. Rebuilds must NOT empty the folder: on Windows the open
  // window keeps files locked, the cleanup fails half-way and leaves a blank page.
  fs.rmSync(outDir, { recursive: true, force: true });

  return new Promise((resolve, reject) => {
    build({
      configFile: path.join(projectRoot, 'vite.config.js'),
      logLevel: 'warn',
      build: { outDir, emptyOutDir: false, watch: {} },
    })
      .then((watcher) => {
        const close = async () => {
          await watcher.close?.();
        };
        watcher.on('event', (event) => {
          if (event.code === 'BUNDLE_END') void event.result?.close?.();
          if (event.code === 'ERROR') {
            console.error('[renderer] build failed:', event.error);
            if (!firstBuildDone) reject(event.error);
          }
          if (event.code === 'END') {
            if (!firstBuildDone && fs.existsSync(path.join(outDir, 'index.html'))) {
              firstBuildDone = true;
              console.log('[renderer] dev build ready (watching for changes)');
              resolve({ close });
            } else if (firstBuildDone) {
              onRebuilt();
            }
          }
        });
      })
      .catch(reject);
  });
}
