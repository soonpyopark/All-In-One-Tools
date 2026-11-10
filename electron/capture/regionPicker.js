import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BrowserWindow, ipcMain, screen } from 'electron';
import { captureDisplay } from './screenCapture.js';

const here = path.dirname(fileURLToPath(import.meta.url));

/** 한 번에 하나의 선택 창만 허용합니다. */
let picking = false;

/**
 * 연결된 모든 모니터를 캡처해 각각 전체 화면 오버레이에 깔고, 사용자가 아무 모니터에서나 드래그한 영역을
 * 절대 좌표(가상 데스크톱 좌표계) 값으로 돌려줍니다. 취소하면 null.
 * (앱 창은 호출하는 쪽에서 미리 숨깁니다.)
 *
 * @returns {Promise<import('./presets.js').Region | null>}
 */
export async function pickRegion() {
  if (picking) throw new Error('이미 영역 선택 중입니다.');
  picking = true;
  /** @type {BrowserWindow[]} */
  const wins = [];
  try {
    const displays = screen.getAllDisplays();
    const shots = [];
    for (const display of displays) {
      const { image, geo } = await captureDisplay(display);
      shots.push({
        display,
        geo,
        dataUrl: `data:image/jpeg;base64,${image.toJPEG(85).toString('base64')}`,
      });
    }

    return await new Promise((resolve) => {
      let settled = false;
      /** webContents id → 모니터 정보 */
      const byId = new Map();

      const finish = (/** @type {import('./presets.js').Region | null} */ region) => {
        if (settled) return;
        settled = true;
        ipcMain.removeListener('region:done', onDone);
        ipcMain.removeListener('region:cancel', onCancel);
        for (const win of wins) {
          if (!win.isDestroyed()) win.destroy();
        }
        resolve(region);
      };
      /** @param {import('electron').IpcMainEvent} event @param {any} rect */
      const onDone = (event, rect) => {
        const info = byId.get(event.sender.id);
        if (!info) return;
        // 오버레이의 CSS 픽셀(DIP) → 좌표계 단위.
        // 창이 모니터보다 작게 열렸더라도 어긋나지 않도록 오버레이가 알려 준 실제 표시 크기를 기준으로 비율을 계산합니다.
        const viewW = Number(rect?.viewWidth) > 0 ? Number(rect.viewWidth) : info.display.bounds.width;
        const viewH = Number(rect?.viewHeight) > 0 ? Number(rect.viewHeight) : info.display.bounds.height;
        const scaleX = info.geo.width / viewW;
        const scaleY = info.geo.height / viewH;
        const width = Math.round(Number(rect?.width) * scaleX);
        const height = Math.round(Number(rect?.height) * scaleY);
        if (!(width > 0 && height > 0)) return finish(null);
        finish({
          x: info.geo.x + Math.round(Number(rect.x) * scaleX),
          y: info.geo.y + Math.round(Number(rect.y) * scaleY),
          width,
          height,
        });
      };
      /** @param {import('electron').IpcMainEvent} event */
      const onCancel = (event) => {
        if (byId.has(event.sender.id)) finish(null);
      };
      ipcMain.on('region:done', onDone);
      ipcMain.on('region:cancel', onCancel);

      const cursorDisplayId = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).id;

      for (const shot of shots) {
        const { display } = shot;
        const win = new BrowserWindow({
          x: display.bounds.x,
          y: display.bounds.y,
          width: display.bounds.width,
          height: display.bounds.height,
          frame: false,
          resizable: false,
          movable: false,
          minimizable: false,
          maximizable: false,
          // Windows 에서는 전체 화면으로 열어 작업표시줄까지 덮습니다. (그러지 않으면 캡처 이미지 속 작업표시줄과
          // 실제 작업표시줄이 두 번 보입니다.)
          fullscreenable: process.platform === 'win32',
          fullscreen: process.platform === 'win32',
          skipTaskbar: true,
          alwaysOnTop: true,
          show: false,
          backgroundColor: '#000000',
          webPreferences: {
            preload: path.join(here, 'regionPickerPreload.cjs'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
          },
        });
        win.setAlwaysOnTop(true, 'screen-saver');
        win.setBounds(display.bounds);
        win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
        win.webContents.on('will-navigate', (event) => event.preventDefault());
        win.on('closed', () => finish(null));
        byId.set(win.webContents.id, shot);
        wins.push(win);

        win.webContents.once('did-finish-load', () => {
          if (win.isDestroyed()) return;
          win.webContents.send('region:init', { dataUrl: shot.dataUrl });
          win.show();
          // Esc 로 취소할 수 있게 마우스가 있는 모니터의 창에 포커스를 줍니다.
          if (display.id === cursorDisplayId) win.focus();
        });
        void win.loadFile(path.join(here, 'regionPicker.html'));
      }
    });
  } finally {
    for (const win of wins) {
      if (!win.isDestroyed()) win.destroy();
    }
    picking = false;
  }
}
