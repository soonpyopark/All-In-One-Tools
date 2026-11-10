import { BrowserWindow, screen } from 'electron';

/** 번호 표시를 유지하는 시간 (ms) */
const SHOW_MS = 2500;

/** 표시 중인 번호 창들 (연속 클릭 시 이전 것을 먼저 닫습니다) */
/** @type {BrowserWindow[]} */
let overlays = [];

function closeOverlays() {
  for (const win of overlays) {
    if (!win.isDestroyed()) win.destroy();
  }
  overlays = [];
}

/** @param {number} number @param {boolean} primary */
function buildHtml(number, primary) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;height:100%;overflow:hidden;background:transparent;font-family:'Segoe UI','Malgun Gothic',sans-serif}
.frame{box-sizing:border-box;height:100%;border:10px solid #2563eb;display:flex;align-items:center;justify-content:center;background:rgba(15,23,42,.35)}
.box{display:flex;flex-direction:column;align-items:center;gap:8px;padding:28px 56px;border-radius:24px;background:rgba(15,23,42,.85);color:#fff}
.num{font-size:220px;font-weight:800;line-height:1}
.sub{font-size:28px;color:#bfdbfe}
</style></head><body><div class="frame"><div class="box"><div class="num">${number}</div><div class="sub">${primary ? '주 모니터' : '화면 ' + number}</div></div></div></body></html>`;
}

/**
 * 연결된 모든 모니터에 번호를 잠깐 띄웁니다. (목록의 "화면 N" 과 같은 순서/번호)
 * 마우스 입력은 아래로 통과하며 창은 자동으로 닫힙니다.
 */
export function identifyDisplays() {
  closeOverlays();
  const primaryId = screen.getPrimaryDisplay().id;
  const displays = screen.getAllDisplays();

  displays.forEach((display, index) => {
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
      focusable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      show: false,
      hasShadow: false,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setIgnoreMouseEvents(true);
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (event) => event.preventDefault());
    win.once('ready-to-show', () => {
      if (!win.isDestroyed()) win.showInactive();
    });
    void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(buildHtml(index + 1, display.id === primaryId))}`);
    overlays.push(win);
  });

  setTimeout(closeOverlays, SHOW_MS);
  return { count: displays.length };
}
