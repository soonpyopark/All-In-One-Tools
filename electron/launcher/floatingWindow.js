/**
 * 바탕화면 플로팅 런처 창 (초안).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BrowserWindow, Menu, dialog, ipcMain, screen, shell } from 'electron';
import { APP_NAME } from '../../shared/constants.js';
import { decorateLauncherItemsForUi } from '../../shared/launcherColors.js';
import { showMainWindow } from '../trayService.js';
import { listLauncherItems, removeLauncherItem } from './store.js';
import { readFloatingSettings, updateFloatingSettings } from './floatingStore.js';

const here = path.dirname(fileURLToPath(import.meta.url));

/** @type {BrowserWindow | null} */
let floatWin = null;
let ipcBound = false;
/** 초기 배치 중에는 위치를 파일에 쓰지 않음 */
let suppressPositionPersist = false;
/** @type {ReturnType<typeof setTimeout> | null} */
let persistPositionTimer = null;

/** @returns {BrowserWindow | null} */
function mainWindow() {
  const wins = BrowserWindow.getAllWindows().filter(
    (win) => !win.isDestroyed() && win !== floatWin,
  );
  return (
    wins.find((win) => win.getTitle().startsWith(APP_NAME) && !win.isFullScreen()) ??
    wins[0] ??
    null
  );
}

/** @param {import('electron').IpcMainEvent | import('electron').IpcMainInvokeEvent} event */
export function isFloatingLauncherSender(event) {
  return Boolean(floatWin && !floatWin.isDestroyed() && event.sender.id === floatWin.webContents.id);
}

function itemPayload() {
  return { items: decorateLauncherItemsForUi(listLauncherItems()) };
}

function pushState() {
  if (!floatWin || floatWin.isDestroyed()) return;
  const settings = readFloatingSettings();
  floatWin.webContents.send('floating-launcher:items', itemPayload());
  floatWin.webContents.send('floating-launcher:settings', settings);
  applyWindowChrome(settings);
}

/**
 * 메인 창 런처 목록을 즉시 갱신합니다.
 * @param {import('./store.js').LauncherItem[] | undefined} [items]
 */
export function notifyMainLauncherItems(items) {
  const list = Array.isArray(items) ? items : listLauncherItems();
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed() || win === floatWin) continue;
    try {
      win.webContents.send('launcher:items-changed', { items: list });
    } catch {
      /* ignore */
    }
  }
}

/**
 * 플로팅·메인 창 모두에 목록 변경을 알립니다.
 * @param {import('./store.js').LauncherItem[] | undefined} [items]
 */
export function broadcastLauncherItemsChanged(items) {
  const list = Array.isArray(items) ? items : listLauncherItems();
  if (floatWin && !floatWin.isDestroyed()) {
    pushState();
    resizeToContent(list.length);
  }
  notifyMainLauncherItems(list);
}

/**
 * @param {import('./floatingStore.js').FloatingLauncherSettings} settings
 */
function applyWindowChrome(settings) {
  if (!floatWin || floatWin.isDestroyed()) return;
  floatWin.setAlwaysOnTop(Boolean(settings.alwaysOnTop), 'floating');
  // 호버 선명 모드는 평소 설정 투명도, 올리면 창 불투명도 1
  floatWin.setOpacity(settings.opacity);
}

function resizeToContent(count) {
  if (!floatWin || floatWin.isDestroyed()) return;
  const n = Math.max(1, Number(count) || 1);
  // 좌우·하단 여백: CSS 그림자가 창 밖으로 잘리지 않게
  // 핸들·아이템·구분선·추가(드롭 안내)·여백
  const width = Math.min(960, 48 + 14 + n * 74 + 18 + 74 + 24);
  const height = 124;
  const bounds = floatWin.getBounds();
  floatWin.setBounds({ ...bounds, width, height });
}

function showContextMenu() {
  if (!floatWin || floatWin.isDestroyed()) return;
  const settings = readFloatingSettings();
  const menu = Menu.buildFromTemplate([
    {
      label: '투명도',
      submenu: [0.5, 0.7, 0.85, 1].map((value) => ({
        label: `${Math.round(value * 100)}%`,
        type: 'radio',
        checked: Math.abs(settings.opacity - value) < 0.03,
        click: () => {
          void updateFloatingSettings({ opacity: value }).then((next) => {
            applyWindowChrome(next);
            pushState();
          });
        },
      })),
    },
    {
      label: '마우스 올리면 선명하게',
      type: 'checkbox',
      checked: settings.sharpenOnHover,
      click: (menuItem) => {
        void updateFloatingSettings({ sharpenOnHover: menuItem.checked }).then((next) => {
          applyWindowChrome(next);
          pushState();
        });
      },
    },
    {
      label: '항상 위에 표시',
      type: 'checkbox',
      checked: settings.alwaysOnTop,
      click: (menuItem) => {
        void updateFloatingSettings({ alwaysOnTop: menuItem.checked }).then((next) => {
          applyWindowChrome(next);
          pushState();
        });
      },
    },
    {
      label: '위치 초기화',
      click: () => {
        void updateFloatingSettings({ x: null, y: null }).then(() => {
          placeDefault();
          pushState();
        });
      },
    },
    {
      label: '새로고침',
      click: () => {
        pushState();
        resizeToContent(listLauncherItems().length);
      },
    },
    { type: 'separator' },
    {
      label: '메인 창 열기',
      click: () => focusMainFromFloating(),
    },
    {
      label: '플로팅 런처 종료',
      click: () => hideFloatingLauncher(),
    },
  ]);
  menu.popup({ window: floatWin });
}

function placeDefault() {
  if (!floatWin || floatWin.isDestroyed()) return;
  const display = screen.getPrimaryDisplay();
  const work = display.workArea;
  const bounds = floatWin.getBounds();
  const x = Math.round(work.x + (work.width - bounds.width) / 2);
  // 작업 영역 하단보다 6px 아래 (이전에 4px 위였던 위치에서 10px 더 내림)
  const y = Math.round(work.y + work.height - bounds.height + 6);
  floatWin.setPosition(x, y);
}

/**
 * 저장된 좌표가 현재 모니터 작업 영역에 일부라도 보이는지 확인합니다.
 * @param {number} x
 * @param {number} y
 * @param {number} width
 * @param {number} height
 */
function isPositionOnScreen(x, y, width, height) {
  const displays = screen.getAllDisplays();
  for (const display of displays) {
    const area = display.workArea;
    const overlapW = Math.min(x + width, area.x + area.width) - Math.max(x, area.x);
    const overlapH = Math.min(y + height, area.y + area.height) - Math.max(y, area.y);
    if (overlapW >= 48 && overlapH >= 40) return true;
  }
  return false;
}

/** 마지막 사용 위치를 즉시 저장합니다. */
function persistPositionNow() {
  if (suppressPositionPersist || !floatWin || floatWin.isDestroyed()) return;
  const bounds = floatWin.getBounds();
  void updateFloatingSettings({ x: Math.round(bounds.x), y: Math.round(bounds.y) });
}

/** 드래그 중 잦은 쓰기를 줄이기 위해 짧게 디바운스합니다. */
function persistPositionSoon() {
  if (suppressPositionPersist) return;
  if (persistPositionTimer) clearTimeout(persistPositionTimer);
  persistPositionTimer = setTimeout(() => {
    persistPositionTimer = null;
    persistPositionNow();
  }, 180);
}

/** 앱 종료·창 닫기 직전 호출. */
export function persistFloatingLauncherState() {
  if (persistPositionTimer) {
    clearTimeout(persistPositionTimer);
    persistPositionTimer = null;
  }
  persistPositionNow();
}

function bindIpcOnce() {
  if (ipcBound) return;
  ipcBound = true;

  ipcMain.on('floating-launcher:ready', (event) => {
    if (!isFloatingLauncherSender(event)) return;
    pushState();
    resizeToContent(listLauncherItems().length);
  });

  ipcMain.on('floating-launcher:context-menu', (event) => {
    if (!isFloatingLauncherSender(event)) return;
    showContextMenu();
  });

  ipcMain.on('floating-launcher:move-by', (event, dx, dy) => {
    if (!isFloatingLauncherSender(event) || !floatWin || floatWin.isDestroyed()) return;
    const bounds = floatWin.getBounds();
    floatWin.setPosition(bounds.x + Math.round(Number(dx) || 0), bounds.y + Math.round(Number(dy) || 0));
    // 커스텀 드래그는 OS moved 이벤트가 안 뜨는 경우가 많아 여기서도 저장 예약
    persistPositionSoon();
  });

  ipcMain.on('floating-launcher:move-end', (event) => {
    if (!isFloatingLauncherSender(event)) return;
    if (persistPositionTimer) {
      clearTimeout(persistPositionTimer);
      persistPositionTimer = null;
    }
    persistPositionNow();
  });

  ipcMain.on('floating-launcher:hover', (event, hovering) => {
    if (!isFloatingLauncherSender(event) || !floatWin || floatWin.isDestroyed()) return;
    const settings = readFloatingSettings();
    if (!settings.sharpenOnHover) {
      floatWin.setOpacity(settings.opacity);
      return;
    }
    floatWin.setOpacity(hovering ? 1 : settings.opacity);
  });
}

export function showFloatingLauncher() {
  bindIpcOnce();
  const settings = readFloatingSettings();
  const count = listLauncherItems().length || 1;
  const width = Math.min(960, 48 + 14 + count * 74 + 18 + 74 + 24);
  const height = 124;

  if (floatWin && !floatWin.isDestroyed()) {
    pushState();
    resizeToContent(listLauncherItems().length);
    floatWin.show();
    floatWin.focus();
    return { ok: true, reused: true };
  }

  floatWin = new BrowserWindow({
    width,
    height,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    show: false,
    alwaysOnTop: settings.alwaysOnTop,
    backgroundColor: '#00000000',
    // 투명+둥근 바에선 OS 사각 그림자가 지저분하므로 CSS 그림자만 사용
    hasShadow: false,
    webPreferences: {
      preload: path.join(here, 'floatingPreload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  floatWin.setAlwaysOnTop(Boolean(settings.alwaysOnTop), 'floating');
  applyWindowChrome(settings);

  // 초기 setPosition 이 저장 파일을 덮어쓰지 않도록 잠시 억제
  suppressPositionPersist = true;
  const bounds = floatWin.getBounds();
  if (
    settings.x != null &&
    settings.y != null &&
    isPositionOnScreen(settings.x, settings.y, bounds.width, bounds.height)
  ) {
    floatWin.setPosition(settings.x, settings.y);
  } else {
    placeDefault();
  }
  setTimeout(() => {
    suppressPositionPersist = false;
  }, 300);

  floatWin.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  floatWin.webContents.on('will-navigate', (event) => event.preventDefault());

  floatWin.on('moved', () => persistPositionSoon());
  floatWin.on('close', () => {
    persistFloatingLauncherState();
  });
  floatWin.on('closed', () => {
    floatWin = null;
  });

  void floatWin.loadFile(path.join(here, 'floating.html'));
  floatWin.once('ready-to-show', () => {
    if (!floatWin || floatWin.isDestroyed()) return;
    // 표시 직전에 저장된 설정·위치를 한 번 더 맞춤 (DPI/모니터 변경 대비)
    const latest = readFloatingSettings();
    applyWindowChrome(latest);
    const current = floatWin.getBounds();
    if (
      latest.x != null &&
      latest.y != null &&
      isPositionOnScreen(latest.x, latest.y, current.width, current.height)
    ) {
      suppressPositionPersist = true;
      floatWin.setPosition(latest.x, latest.y);
      setTimeout(() => {
        suppressPositionPersist = false;
      }, 300);
    }
    floatWin.show();
  });

  return { ok: true, reused: false };
}

export function hideFloatingLauncher() {
  if (!floatWin || floatWin.isDestroyed()) return { ok: true };
  persistFloatingLauncherState();
  floatWin.close();
  floatWin = null;
  return { ok: true };
}

export function focusMainFromFloating() {
  // 메인 창이 닫혀 있어도 다시 연다 (플로팅만 떠 있는 경우)
  return { ok: showMainWindow() };
}

/**
 * 메인 창을 앞으로 가져오고(없으면 생성), 런처에서 해당 바로가기 편집을 엽니다.
 * @param {string} id
 */
export function editItemFromFloating(id) {
  const itemId = String(id ?? '').trim();
  if (!showMainWindow()) return { ok: false };

  const win = mainWindow();
  if (!win || win.isDestroyed()) return { ok: false };

  const sendEdit = () => {
    if (!itemId || win.isDestroyed()) return;
    win.webContents.send('launcher:edit-item', { id: itemId });
  };

  // 창을 방금 다시 만든 경우 렌더러 구독 전에 이벤트가 날아가지 않도록 대기
  if (win.webContents.isLoading()) {
    win.webContents.once('did-finish-load', () => {
      setTimeout(sendEdit, 200);
    });
  } else {
    setTimeout(sendEdit, 50);
  }
  return { ok: true };
}

/**
 * 플로팅에서 바로가기 삭제 — 확인 후 제거합니다.
 * @param {string} id
 */
export async function removeItemFromFloating(id) {
  const itemId = String(id ?? '').trim();
  if (!itemId) return { cancelled: true, items: listLauncherItems() };

  const item = listLauncherItems().find((entry) => entry.id === itemId);
  if (!item) return { cancelled: true, items: listLauncherItems() };

  const parent = floatWin && !floatWin.isDestroyed() ? floatWin : undefined;
  const result = await dialog.showMessageBox(parent, {
    type: 'question',
    buttons: ['삭제', '취소'],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
    title: '바로가기 삭제',
    message: `「${item.title}」을(를) 삭제할까요?`,
    detail: '런처 목록에서만 제거되며, 원본 파일·바로가기는 그대로 둡니다.',
  });

  if (result.response !== 0) {
    return { cancelled: true, items: listLauncherItems() };
  }

  const items = await removeLauncherItem(itemId);
  broadcastLauncherItemsChanged(items);
  return { cancelled: false, items: decorateLauncherItemsForUi(items) };
}

export function refreshFloatingLauncher() {
  if (!floatWin || floatWin.isDestroyed()) return;
  pushState();
  resizeToContent(listLauncherItems().length);
}
