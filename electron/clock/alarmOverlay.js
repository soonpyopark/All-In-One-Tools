/**
 * 알람·타이머 울림 시 모니터 가운데 큰 오버레이를 띄웁니다.
 * (화면 인식 번호 표시와 비슷하지만, 닫기/스누즈를 누를 때까지 유지)
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BrowserWindow, ipcMain, screen } from 'electron';

const here = path.dirname(fileURLToPath(import.meta.url));

/** @type {BrowserWindow[]} */
let overlays = [];
let handlersReady = false;

function ensureHandlers() {
  if (handlersReady) return;
  handlersReady = true;

  ipcMain.removeHandler('alarm-overlay:dismiss');
  ipcMain.removeHandler('alarm-overlay:snooze');

  ipcMain.handle('alarm-overlay:dismiss', async () => {
    const { dismissRinging } = await import('./scheduler.js');
    return dismissRinging();
  });
  ipcMain.handle('alarm-overlay:snooze', async (_event, minutes) => {
    const { snoozeRinging } = await import('./scheduler.js');
    const mins = Number(minutes);
    return snoozeRinging(Number.isFinite(mins) ? mins : 5);
  });
}

export function closeAlarmOverlay() {
  for (const win of overlays) {
    if (!win.isDestroyed()) win.destroy();
  }
  overlays = [];
}

/**
 * @param {{ kind: 'alarm' | 'timer', title?: string }} event
 */
export function showAlarmOverlay(event) {
  ensureHandlers();
  closeAlarmOverlay();

  const payload = {
    kind: event?.kind === 'timer' ? 'timer' : 'alarm',
    title: String(event?.title ?? '').trim() || '시간이 되었습니다.',
  };

  const displays = screen.getAllDisplays();
  for (const display of displays) {
    const win = new BrowserWindow({
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      height: display.bounds.height,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      focusable: true,
      skipTaskbar: true,
      alwaysOnTop: true,
      show: false,
      hasShadow: false,
      webPreferences: {
        preload: path.join(here, 'alarmOverlayPreload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    win.setAlwaysOnTop(true, 'screen-saver');
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (navEvent) => navEvent.preventDefault());
    win.once('ready-to-show', () => {
      if (!win.isDestroyed()) win.show();
    });
    win.webContents.on('did-finish-load', () => {
      if (!win.isDestroyed()) win.webContents.send('alarm-overlay:payload', payload);
    });
    void win.loadFile(path.join(here, 'alarmOverlay.html'));
    overlays.push(win);
  }

  // 첫 모니터 창에 포커스
  const first = overlays[0];
  if (first && !first.isDestroyed()) {
    first.focus();
  }
}
