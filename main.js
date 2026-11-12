import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { APP_NAME, APP_USER_MODEL_ID } from './shared/constants.js';
import { ApiError, dispatchApi } from './electron/api/registry.js';
import { registerCoreApi } from './electron/api/coreApi.js';
import { setAppContext } from './electron/context.js';
import { startDevRenderer } from './electron/devRenderer.js';
import { registerModules } from './electron/modules/index.js';
import { runtime } from './electron/runtime.js';
import { getRememberedFolder, getSettings, rememberFolder } from './electron/settingsService.js';
import {
  acquireSingleInstanceLockIfNeeded,
  bindSecondInstanceHandler,
  disposeTrayOnQuit,
  initTrayService,
  markQuitting,
  onAppReadyForTray,
  shouldHideInsteadOfClose,
  shouldQuitOnAllWindowsClosed,
  showMainWindow,
} from './electron/trayService.js';
import { hideTitleBarIcon } from './electron/windowIcon.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// A closed console / pipe must never take the app down with EPIPE.
for (const stream of [process.stdout, process.stderr]) stream?.on?.('error', () => undefined);

const isDev = !app.isPackaged;

// 작업표시줄·바로가기 아이콘이 재부팅 후 기본 아이콘으로 풀리지 않도록 고정 ID 를 먼저 건다.
if (process.platform === 'win32') {
  app.setAppUserModelId(APP_USER_MODEL_ID);
}

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
    // Own userData so a dev run never shares browser data with an installed copy.
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
/* startup                                                                    */
/* -------------------------------------------------------------------------- */

/** @type {BrowserWindow | null} */
let mainWindow = null;
/** Folder the window loads its UI from (dist/ or the dev watch build). */
let rendererDir = '';
/** @type {{ close: () => Promise<void> } | null} */
let devRenderer = null;

rendererDir = isDev ? path.join(__dirname, '.dev-dist') : path.join(__dirname, 'dist');
fs.mkdirSync(storage.stateRoot, { recursive: true });
setAppContext({
  isDev,
  projectRoot: __dirname,
  distDir: rendererDir,
  stateRoot: storage.stateRoot,
  portable: storage.portable,
});
runtime.isDev = isDev;
runtime.stateRoot = storage.stateRoot;
runtime.portable = storage.portable;

initTrayService({
  enabled: getSettings().closeToTray === true,
  resolveIconPath,
  getMainWindow: () => mainWindow,
  ensureMainWindow: () => {
    if (!mainWindow || mainWindow.isDestroyed()) createMainWindow();
  },
});

// 「닫으면 트레이로 보내기」가 켜져 있을 때만 단일 인스턴스. 끄면 여러 창을 동시에 띄울 수 있다.
if (!acquireSingleInstanceLockIfNeeded()) {
  app.quit();
} else {
  bindSecondInstanceHandler();
  app.whenReady().then(boot).catch(fatal);
}

/** @param {unknown} error */
function fatal(error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error('[fatal]', error);
  dialog.showErrorBox(`${APP_NAME} 시작 실패`, message);
  app.exit(1);
}

async function boot() {
  onAppReadyForTray();

  runtime.autoLaunch = {
    supported: !isDev,
    get: () => app.getLoginItemSettings().openAtLogin,
    set: (enabled) => app.setLoginItemSettings({ openAtLogin: Boolean(enabled) }),
  };

  registerCoreApi();
  registerModules();

  if (isDev) {
    devRenderer = await startDevRenderer({
      projectRoot: __dirname,
      outDir: rendererDir,
      onRebuilt: () => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.reloadIgnoringCache();
      },
    });
  } else if (!fs.existsSync(path.join(rendererDir, 'index.html'))) {
    throw new Error('화면 파일(dist/index.html)을 찾을 수 없습니다. `npm run build` 를 먼저 실행하세요.');
  }

  setupMenu();
  registerIpc();
  createMainWindow();

  app.on('activate', () => {
    showMainWindow();
  });
}

/* -------------------------------------------------------------------------- */
/* window                                                                     */
/* -------------------------------------------------------------------------- */

function resolveIconPath() {
  const candidates = [
    path.join(__dirname, 'build', 'icon.ico'),
    path.join(__dirname, 'build', 'icon.png'),
    path.join(process.resourcesPath ?? '', 'icon.ico'),
    path.join(process.resourcesPath ?? '', 'icon.png'),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate));
}

/** True for pages of this app's own UI (files inside the renderer folder). @param {string} url */
function isAppUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'file:') return false;
    const file = path.resolve(fileURLToPath(parsed));
    return file === path.resolve(rendererDir) || file.startsWith(path.resolve(rendererDir) + path.sep);
  } catch {
    return false;
  }
}

/** @param {string} url */
function openExternalSafe(url) {
  if (/^(https?:|mailto:)/i.test(url)) void shell.openExternal(url);
}

function createMainWindow() {
  const icon = resolveIconPath();
  const appUrl = pathToFileURL(path.join(rendererDir, 'index.html')).href;

  const win = new BrowserWindow({
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
  mainWindow = win;

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

  win.on('close', (event) => {
    if (shouldHideInsteadOfClose(win)) {
      event.preventDefault();
    }
  });

  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });

  void win.loadURL(appUrl);
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
/* IPC — the only way the window talks to the backend (no network port)       */
/* -------------------------------------------------------------------------- */

/** Only this app's own page, in its own window, may call the backend. */
function isTrustedSender(event) {
  const win = BrowserWindow.fromWebContents(event.sender);
  return Boolean(win) && !win.isDestroyed() && isAppUrl(event.senderFrame?.url ?? '');
}

/**
 * @param {string} channel
 * @param {(event: import('electron').IpcMainInvokeEvent, ...args: any[]) => unknown} handler
 */
function handleTrusted(channel, handler) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!isTrustedSender(event)) throw new Error('허용되지 않은 요청입니다.');
    return handler(event, ...args);
  });
}

/** Window that sent an IPC call (dialogs attach to it). @param {import('electron').IpcMainInvokeEvent} event */
const senderWindow = (event) => BrowserWindow.fromWebContents(event.sender) ?? undefined;

function registerIpc() {
  /** Backend RPC (electron/api/registry.js). Errors are returned, not thrown, so their message survives IPC. */
  ipcMain.handle('api:call', async (event, name, body) => {
    if (!isTrustedSender(event)) return { ok: false, status: 403, error: '허용되지 않은 요청입니다.' };
    try {
      const result = await dispatchApi(String(name ?? ''), body);
      return { ok: true, data: result === undefined ? null : JSON.parse(JSON.stringify(result)) };
    } catch (error) {
      if (error instanceof ApiError) {
        return { ok: false, status: error.status, error: error.message, ...error.extra };
      }
      console.error('[api] unexpected error:', error);
      return {
        ok: false,
        status: 500,
        error: error instanceof Error ? error.message : '처리 중 오류가 발생했습니다.',
      };
    }
  });

  handleTrusted('frame:getInfo', () => ({
    platform: process.platform,
    arch: process.arch,
    stateRoot: storage.stateRoot,
    portable: storage.portable,
    isDev,
  }));

  handleTrusted('frame:openExternal', (_event, url) => {
    openExternalSafe(String(url ?? ''));
  });

  /** Reveals the state folder (or a sub-folder of it) in the OS file manager. */
  handleTrusted('frame:openStateFolder', async (_event, sub = '') => {
    const root = path.resolve(storage.stateRoot);
    const target = path.resolve(root, String(sub ?? ''));
    if (target !== root && !target.startsWith(root + path.sep)) return false;
    fs.mkdirSync(target, { recursive: true });
    return (await shell.openPath(target)) === '';
  });

  // `options.memoryKey`: the dialog opens in the folder last chosen for that key,
  // and the new choice is remembered for next time (settings.json → folders).
  handleTrusted('frame:pickDirectory', async (event, options = {}) => {
    const memoryKey = typeof options?.memoryKey === 'string' ? options.memoryKey : '';
    const defaultPath = memoryKey ? getRememberedFolder(memoryKey) : '';
    const result = await dialog.showOpenDialog(senderWindow(event), {
      title: typeof options?.title === 'string' ? options.title : '폴더 선택',
      properties: ['openDirectory'],
      ...(defaultPath ? { defaultPath } : {}),
    });
    if (result.canceled || !result.filePaths[0]) return { canceled: true, path: '' };
    if (memoryKey) void rememberFolder(memoryKey, result.filePaths[0]).catch(() => undefined);
    return { canceled: false, path: result.filePaths[0] };
  });

  handleTrusted('frame:pickOpenFiles', async (event, options = {}) => {
    const filters = Array.isArray(options?.filters) ? options.filters : undefined;
    const multi = options?.multi !== false;
    const memoryKey = typeof options?.memoryKey === 'string' ? options.memoryKey : '';
    const defaultPath = memoryKey ? getRememberedFolder(memoryKey) : '';
    const result = await dialog.showOpenDialog(senderWindow(event), {
      title: typeof options?.title === 'string' ? options.title : '파일 선택',
      properties: multi ? ['openFile', 'multiSelections'] : ['openFile'],
      filters,
      ...(defaultPath ? { defaultPath } : {}),
    });
    if (result.canceled || result.filePaths.length === 0) return { canceled: true, paths: [] };
    if (memoryKey) void rememberFolder(memoryKey, path.dirname(result.filePaths[0])).catch(() => undefined);
    return { canceled: false, paths: result.filePaths };
  });

  handleTrusted('frame:showItemInFolder', (_event, targetPath) => {
    const resolved = path.resolve(String(targetPath ?? ''));
    if (!resolved || !fs.existsSync(resolved)) return false;
    shell.showItemInFolder(resolved);
    return true;
  });

  handleTrusted('frame:getAlwaysOnTop', (event) => {
    const win = senderWindow(event);
    return { enabled: Boolean(win && !win.isDestroyed() && win.isAlwaysOnTop()) };
  });

  handleTrusted('frame:setAlwaysOnTop', (event, enabled) => {
    const win = senderWindow(event);
    if (!win || win.isDestroyed()) return { enabled: false };
    win.setAlwaysOnTop(Boolean(enabled));
    return { enabled: win.isAlwaysOnTop() };
  });
}

/* -------------------------------------------------------------------------- */
/* shutdown                                                                   */
/* -------------------------------------------------------------------------- */

app.on('window-all-closed', () => {
  if (!shouldQuitOnAllWindowsClosed()) return;
  app.quit();
});

app.on('before-quit', () => {
  markQuitting();
  disposeTrayOnQuit();
  void devRenderer?.close().catch(() => undefined);
});
