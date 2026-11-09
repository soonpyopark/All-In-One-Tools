import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_NAME } from './shared/constants.js';
import { registerCoreApi } from './electron/api/coreApi.js';
import { setAppContext } from './electron/context.js';
import { createEnvReader } from './electron/envConfig.js';
import { createServerManager } from './electron/httpServer.js';
import { registerModules } from './electron/modules/index.js';
import { runtime } from './electron/runtime.js';
import { createTrayController } from './electron/tray.js';
import { hideTitleBarIcon } from './electron/windowIcon.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// A closed console / pipe must never take the app down with EPIPE.
for (const stream of [process.stdout, process.stderr]) stream?.on?.('error', () => undefined);

const isDev = !app.isPackaged;

/* -------------------------------------------------------------------------- */
/* state folder                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Where settings and job outputs live:
 *   - APP_DATA_DIR env override
 *   - dev            → <project>/data
 *   - portable zip   → <exe folder>/data   (marker file `.portable` beside the exe)
 *   - installed (MSI / dmg) → <userData>/data
 */
function resolveStorage() {
  const override = String(process.env.APP_DATA_DIR ?? '').trim();
  const exeDir = path.dirname(app.getPath('exe'));
  const portable = !isDev && fs.existsSync(path.join(exeDir, '.portable'));

  if (isDev) {
    // Own userData so a dev run never fights an installed copy for the instance lock.
    app.setPath('userData', path.join(__dirname, '.dev-userdata'));
  } else if (portable) {
    app.setPath('userData', path.join(exeDir, 'data-cache'));
  }

  const stateRoot = override
    ? path.resolve(override)
    : isDev
      ? path.join(__dirname, 'data')
      : portable
        ? path.join(exeDir, 'data')
        : path.join(app.getPath('userData'), 'data');

  return { stateRoot, portable, exeDir };
}

const storage = resolveStorage();

/* -------------------------------------------------------------------------- */
/* single instance                                                            */
/* -------------------------------------------------------------------------- */

/** @type {BrowserWindow | null} */
let mainWindow = null;
let isQuitting = false;
/** @type {ReturnType<typeof createServerManager> | null} */
let serverManager = null;
/** @type {ReturnType<typeof createTrayController> | null} */
let trayController = null;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.whenReady().then(() => {
    dialog.showMessageBoxSync({
      type: 'info',
      title: APP_NAME,
      message: '프로그램이 이미 실행 중입니다.',
      buttons: ['확인'],
    });
    app.exit(0);
  });
} else {
  app.on('second-instance', focusMainWindow);
  app.whenReady().then(boot).catch(fatal);
}

function focusMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

/** @param {unknown} error */
function fatal(error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error('[fatal]', error);
  dialog.showErrorBox(`${APP_NAME} 시작 실패`, message);
  app.exit(1);
}

/* -------------------------------------------------------------------------- */
/* boot                                                                       */
/* -------------------------------------------------------------------------- */

async function boot() {
  fs.mkdirSync(storage.stateRoot, { recursive: true });

  setAppContext({
    isDev,
    projectRoot: __dirname,
    distDir: path.join(__dirname, 'dist'),
    stateRoot: storage.stateRoot,
    portable: storage.portable,
  });
  runtime.isDev = isDev;
  runtime.stateRoot = storage.stateRoot;
  runtime.portable = storage.portable;
  runtime.autoLaunch = {
    supported: !isDev,
    get: () => app.getLoginItemSettings().openAtLogin,
    set: (enabled) => app.setLoginItemSettings({ openAtLogin: Boolean(enabled) }),
  };

  registerCoreApi();
  registerModules();

  serverManager = createServerManager({
    isDev,
    projectRoot: __dirname,
    distDir: path.join(__dirname, 'dist'),
    env: createEnvReader([storage.exeDir, storage.stateRoot, ...(isDev ? [__dirname] : [])]),
  });
  runtime.server = serverManager;

  let info;
  try {
    info = await serverManager.start();
  } catch (err) {
    if (err?.code === 'EADDRINUSE') {
      throw new Error(
        '내부 서버 포트가 이미 사용 중입니다.\n다른 프로그램을 종료하거나 .env 의 APP_PORT 를 바꿔 주세요.',
      );
    }
    throw err;
  }

  setupMenu();
  registerIpc();
  createMainWindow(info.appUrl);
  trayController = createTrayController({
    resolveIconPath,
    getMainWindow: () => mainWindow,
    focusMainWindow,
    quitApp: quitFromTray,
  });
  trayController.create();

  app.on('activate', () => {
    focusMainWindow();
  });
}

/* -------------------------------------------------------------------------- */
/* window                                                                     */
/* -------------------------------------------------------------------------- */

function resolveIconPath() {
  const candidates = [
    path.join(__dirname, 'build', 'icon.png'),
    path.join(process.resourcesPath ?? '', 'icon.png'),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate));
}

/** @param {string} url */
function isAppUrl(url) {
  try {
    const parsed = new URL(url);
    const info = serverManager?.info();
    return /^https?:$/.test(parsed.protocol) && Number(parsed.port) === info?.port;
  } catch {
    return false;
  }
}

/** @param {string} url */
function openExternalSafe(url) {
  if (/^(https?:|mailto:)/i.test(url)) void shell.openExternal(url);
}

/** @param {string} appUrl */
function createMainWindow(appUrl) {
  const icon = resolveIconPath();

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    title: APP_NAME,
    backgroundColor: '#0f172a',
    autoHideMenuBar: true,
    show: false,
    ...(icon ? { icon } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const win = mainWindow;
  // The title-bar icon can only be removed from a window that is already shown
  // (Windows re-applies the icon on first show), so show it invisibly, drop the
  // icon, then fade it in — no flash of the icon.
  win.once('ready-to-show', () => {
    win.setOpacity(0);
    win.show();
    void hideTitleBarIcon(win).finally(() => {
      if (!win.isDestroyed()) win.setOpacity(1);
    });
  });
  win.webContents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    if (!isMainFrame) return;
    console.error(`[window] load failed: ${description} (${code}) ${url}`);
    // The server may not be ready yet — try once more.
    setTimeout(() => {
      if (!win.isDestroyed()) void win.loadURL(url || appUrl);
    }, 800);
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternalSafe(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (isAppUrl(url)) return;
    event.preventDefault();
    openExternalSafe(url);
  });

  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const ctrl = input.control || input.meta;
    if (input.key === 'F5' || (ctrl && input.key.toLowerCase() === 'r')) {
      win.webContents.reload();
      event.preventDefault();
    } else if (isDev && (input.key === 'F12' || (ctrl && input.shift && input.key.toLowerCase() === 'i'))) {
      win.webContents.toggleDevTools();
      event.preventDefault();
    }
  });

  // X closes → hide to tray (Exit in the tray menu actually quits).
  win.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      win.hide();
    }
  });

  win.on('closed', () => {
    mainWindow = null;
  });

  void win.loadURL(appUrl);
}

function quitFromTray() {
  isQuitting = true;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.removeAllListeners('close');
    mainWindow.close();
  }
  app.quit();
}

function setupMenu() {
  if (process.platform === 'darwin') {
    // macOS needs an Edit menu or Cmd+C / Cmd+V stop working.
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        { role: 'appMenu' },
        { role: 'editMenu' },
        { role: 'windowMenu' },
      ]),
    );
  } else {
    Menu.setApplicationMenu(null);
  }
}

/* -------------------------------------------------------------------------- */
/* IPC (native bridge exposed to the window by preload.cjs)                   */
/* -------------------------------------------------------------------------- */

function registerIpc() {
  ipcMain.handle('frame:getInfo', () => ({
    platform: process.platform,
    arch: process.arch,
    stateRoot: storage.stateRoot,
    portable: storage.portable,
    isDev,
  }));

  ipcMain.handle('frame:openExternal', (_event, url) => {
    openExternalSafe(String(url ?? ''));
  });

  /** Reveals the state folder (or a sub-folder of it) in the OS file manager. */
  ipcMain.handle('frame:openStateFolder', async (_event, sub = '') => {
    const root = path.resolve(storage.stateRoot);
    const target = path.resolve(root, String(sub ?? ''));
    if (target !== root && !target.startsWith(root + path.sep)) return false;
    fs.mkdirSync(target, { recursive: true });
    return (await shell.openPath(target)) === '';
  });

  ipcMain.handle('frame:pickDirectory', async () => {
    const parent = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
    const result = await dialog.showOpenDialog(parent, {
      title: '폴더 선택',
      properties: ['openDirectory'],
    });
    if (result.canceled || !result.filePaths[0]) return { canceled: true, path: '' };
    return { canceled: false, path: result.filePaths[0] };
  });

  ipcMain.handle('frame:pickOpenFiles', async (_event, options = {}) => {
    const parent = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
    const filters = Array.isArray(options?.filters) ? options.filters : undefined;
    const multi = options?.multi !== false;
    const result = await dialog.showOpenDialog(parent, {
      title: typeof options?.title === 'string' ? options.title : '파일 선택',
      properties: multi ? ['openFile', 'multiSelections'] : ['openFile'],
      filters,
    });
    if (result.canceled || result.filePaths.length === 0) return { canceled: true, paths: [] };
    return { canceled: false, paths: result.filePaths };
  });

  ipcMain.handle('frame:showItemInFolder', (_event, targetPath) => {
    const resolved = path.resolve(String(targetPath ?? ''));
    if (!resolved || !fs.existsSync(resolved)) return false;
    shell.showItemInFolder(resolved);
    return true;
  });
}

/* -------------------------------------------------------------------------- */
/* shutdown                                                                   */
/* -------------------------------------------------------------------------- */

app.on('window-all-closed', () => {
  // Main window hides to tray — keep the app and server running.
});

let quitCleanupStarted = false;

app.on('before-quit', (event) => {
  isQuitting = true;
  if (quitCleanupStarted) return;
  quitCleanupStarted = true;

  trayController?.destroy();
  trayController = null;
  if (!serverManager) return;

  // Release the port before the process exits.
  event.preventDefault();
  void serverManager
    .stop()
    .catch((err) => console.warn('[server] stop failed:', err))
    .finally(() => app.exit(0));
});
