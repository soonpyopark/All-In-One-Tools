/**
 * QR 전체 화면 창 (캡처보드용).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BrowserWindow, screen } from 'electron';
import { APP_NAME } from '../../shared/constants.js';

const here = path.dirname(fileURLToPath(import.meta.url));

/** @type {BrowserWindow | null} */
let fullscreenWin = null;

function closeFullscreen() {
  if (fullscreenWin && !fullscreenWin.isDestroyed()) {
    fullscreenWin.close();
  }
  fullscreenWin = null;
}

/**
 * @param {string} dataUrl
 * @param {number} canvasModules
 */
export function showQrFullscreen(dataUrl, canvasModules) {
  closeFullscreen();
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const { x, y, width, height } = display.bounds;
  const modules = Math.max(1, Math.floor(Number(canvasModules) || 29));
  const imageUrl = String(dataUrl || '');

  const win = new BrowserWindow({
    x,
    y,
    width,
    height,
    frame: false,
    fullscreen: true,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    autoHideMenuBar: true,
    backgroundColor: '#ffffff',
    title: `${APP_NAME} — QR 전체 화면`,
    webPreferences: {
      preload: path.join(here, 'fullscreenPreload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  fullscreenWin = win;
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setMenuBarVisibility(false);
  win.on('closed', () => {
    if (fullscreenWin === win) fullscreenWin = null;
  });

  win.webContents.once('did-finish-load', () => {
    if (win.isDestroyed()) return;
    win.webContents.send('qr:fullscreen-init', {
      dataUrl: imageUrl,
      canvasModules: modules,
    });
    win.show();
    win.focus();
  });

  void win.loadFile(path.join(here, 'fullscreen.html'));
}

export function hideQrFullscreen() {
  closeFullscreen();
}
