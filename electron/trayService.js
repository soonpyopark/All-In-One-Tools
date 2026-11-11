/**
 * 닫기 → 트레이 유지, 트레이에서 다시 열기 / 종료.
 */
import { Menu, Tray, app, nativeImage } from 'electron';
import { APP_NAME } from '../shared/constants.js';

/** @type {Tray | null} */
let tray = null;
/** @type {boolean} */
let closeToTray = false;
/** @type {boolean} */
let quitting = false;
/** @type {(() => string | undefined) | null} */
let resolveIconPath = null;
/** @type {(() => import('electron').BrowserWindow | null) | null} */
let getMainWindow = null;
/** @type {(() => void) | null} */
let ensureMainWindow = null;

/**
 * @param {{
 *   enabled: boolean,
 *   resolveIconPath: () => string | undefined,
 *   getMainWindow: () => import('electron').BrowserWindow | null,
 *   ensureMainWindow: () => void,
 * }} options
 */
export function initTrayService(options) {
  resolveIconPath = options.resolveIconPath;
  getMainWindow = options.getMainWindow;
  ensureMainWindow = options.ensureMainWindow;
  setCloseToTrayEnabled(Boolean(options.enabled), { restoreWindow: false });
}

export function isCloseToTrayEnabled() {
  return closeToTray;
}

export function isAppQuitting() {
  return quitting;
}

/** 종료 메뉴·before-quit 에서 호출. 이후 close 는 숨기지 않고 닫힌다. */
export function markQuitting() {
  quitting = true;
}

/**
 * @param {boolean} enabled
 * @param {{ restoreWindow?: boolean }} [options]
 */
export function setCloseToTrayEnabled(enabled, options = {}) {
  const restoreWindow = options.restoreWindow !== false;
  closeToTray = Boolean(enabled);
  syncSingleInstanceLock();
  if (closeToTray) {
    // Tray 는 app ready 이후에만 만들 수 있다.
    if (app.isReady()) ensureTray();
    return;
  }
  destroyTray();
  if (restoreWindow) showMainWindow();
}

/** `app.whenReady` 이후 한 번 호출해 트레이를 준비한다. */
export function onAppReadyForTray() {
  if (closeToTray) ensureTray();
}

function trayIcon() {
  const iconPath = resolveIconPath?.();
  if (iconPath) {
    const image = nativeImage.createFromPath(iconPath);
    if (!image.isEmpty()) {
      // Windows 트레이는 작은 아이콘이 선명하다.
      return process.platform === 'win32' ? image.resize({ width: 16, height: 16 }) : image;
    }
  }
  return nativeImage.createEmpty();
}

function ensureTray() {
  if (tray || !closeToTray) return;
  tray = new Tray(trayIcon());
  tray.setToolTip(APP_NAME);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: '열기',
        click: () => showMainWindow(),
      },
      { type: 'separator' },
      {
        label: '종료',
        click: () => {
          markQuitting();
          destroyTray();
          app.quit();
        },
      },
    ]),
  );
  tray.on('click', () => showMainWindow());
  tray.on('double-click', () => showMainWindow());
}

function destroyTray() {
  if (!tray) return;
  tray.destroy();
  tray = null;
}

export function showMainWindow() {
  let win = getMainWindow?.() ?? null;
  if (!win || win.isDestroyed()) {
    ensureMainWindow?.();
    win = getMainWindow?.() ?? null;
  }
  if (!win || win.isDestroyed()) return false;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  return true;
}

/**
 * close 이벤트용. true 이면 창을 숨겼으므로 preventDefault 해야 한다.
 * @param {import('electron').BrowserWindow} win
 */
export function shouldHideInsteadOfClose(win) {
  if (quitting || !closeToTray) return false;
  if (!win || win.isDestroyed()) return false;
  ensureTray();
  win.hide();
  return true;
}

/** 트레이 모드일 때만 단일 인스턴스 잠금. */
export function acquireSingleInstanceLockIfNeeded() {
  if (!closeToTray) return true;
  return app.requestSingleInstanceLock();
}

function syncSingleInstanceLock() {
  if (closeToTray) {
    app.requestSingleInstanceLock();
    return;
  }
  try {
    app.releaseSingleInstanceLock();
  } catch {
    // ignore
  }
}

export function bindSecondInstanceHandler() {
  app.on('second-instance', () => {
    // 트레이 모드에서만 「이미 실행 중」으로 창을 복원한다.
    if (!closeToTray) return;
    showMainWindow();
  });
}

export function disposeTrayOnQuit() {
  destroyTray();
}

/** window-all-closed 에서 종료할지. 트레이로만 숨긴 경우는 창이 남아 있어 보통 호출되지 않는다. */
export function shouldQuitOnAllWindowsClosed() {
  if (quitting) return true;
  if (closeToTray) return false;
  return true;
}
