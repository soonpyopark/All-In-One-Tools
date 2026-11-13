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
/** @type {ReturnType<typeof setTimeout> | null} */
let resizeAnimTimer = null;
/** 접기/펼치기 창 크기 애니메이션 시간 (ms) */
const COLLAPSE_ANIM_MS = 220;

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
  // 호버 선명 모드는 평소 설정 불투명도, 올리면 창 불투명도 1
  floatWin.setOpacity(settings.opacity);
}

/** 플로팅 창 최대 너비. */
const FLOATING_MAX_WIDTH = 1024;
/** 한 페이지 아이콘 수 (초과 시 점·화살표 페이지 UI). floating.html 과 동일 */
/** 빈 바로가기 안내 칸 수 */
const EMPTY_SLOTS = 5;

/**
 * 한 줄에 보이는 아이콘 열 수 (5·7·10).
 * @param {ReturnType<typeof readFloatingSettings>} [settings]
 */
function floatingPageSize(settings = readFloatingSettings()) {
  const n = Number(settings.columns);
  return n === 7 || n === 10 ? n : 5;
}

/**
 * 아이콘 수 기준 예상 너비 (실측 전·창 생성 직후용).
 * 페이지당 최대 columns 개만 한 줄에 둡니다.
 * @param {number} count
 */
function estimateFloatingWidth(count) {
  const settings = readFloatingSettings();
  if (settings.collapsed) return 64;
  const pageSize = floatingPageSize(settings);
  const raw = Math.max(0, Number(count) || 0);
  // 항목이 적으면 빈 칸(+) 기준으로 너비를 잡음
  const n = Math.min(raw < EMPTY_SLOTS ? EMPTY_SLOTS : Math.max(raw, 1), pageSize);
  const multi = raw > pageSize;
  // body 패딩 + 바 패딩 + 핸들 + (페이지 화살표) + 아이템 + (구분선·도움?) + 여유
  const arrows = multi ? 8 + 22 + 8 + 22 : 0;
  const help = settings.hideHelp ? 0 : 10 + 5 + 10 + 48;
  return 28 + 24 + 14 + 10 + arrows + n * 74 - 10 + help + 8;
}

/**
 * 접기/펼치기. 렌더러 설정 반영 후 창 크기를 애니메이션으로 맞춥니다.
 * @param {boolean} collapsed
 */
export async function setFloatingCollapsed(collapsed) {
  await updateFloatingSettings({ collapsed: Boolean(collapsed) });
  pushState();
  // 접기: 아이콘 페이드 후 축소 / 펼치기: 레이아웃 잡힌 뒤 확대
  setTimeout(
    () => {
      resizeToContent(listLauncherItems().length, { animate: true });
    },
    collapsed ? 150 : 80,
  );
  // 트레이「접기/펴기」라벨 동기화 (순환 import 방지: 지연 로드)
  void import('../trayService.js').then((mod) => {
    mod.refreshTrayMenu?.();
  });
  return { ok: true, collapsed: Boolean(collapsed) };
}

/** @param {number} t 0..1 */
function easeOutCubic(t) {
  return 1 - (1 - t) ** 3;
}

/**
 * 왼쪽·하단 고정으로 창 크기를 보간합니다.
 * @param {number} fixedLeft
 * @param {number} fixedBottom
 * @param {number} width
 * @param {number} height
 * @param {number} durationMs
 */
function animateWindowSize(fixedLeft, fixedBottom, width, height, durationMs) {
  if (!floatWin || floatWin.isDestroyed()) return;
  if (resizeAnimTimer) {
    clearTimeout(resizeAnimTimer);
    resizeAnimTimer = null;
  }
  const start = floatWin.getBounds();
  const targetW = width;
  const targetH = height;
  const t0 = Date.now();

  const tick = () => {
    if (!floatWin || floatWin.isDestroyed()) {
      resizeAnimTimer = null;
      return;
    }
    const p = Math.min(1, (Date.now() - t0) / durationMs);
    const e = easeOutCubic(p);
    const w = Math.round(start.width + (targetW - start.width) * e);
    const h = Math.round(start.height + (targetH - start.height) * e);
    floatWin.setBounds({
      x: fixedLeft,
      y: Math.round(fixedBottom - h),
      width: Math.max(1, w),
      height: Math.max(1, h),
    });
    if (p < 1) {
      resizeAnimTimer = setTimeout(tick, 16);
    } else {
      resizeAnimTimer = null;
      // 최종 픽셀 스냅
      floatWin.setBounds({
        x: fixedLeft,
        y: Math.round(fixedBottom - targetH),
        width: targetW,
        height: targetH,
      });
    }
  };
  tick();
}

/**
 * 실제 DOM 크기에 맞춰 창을 키우고, 최대 1024px(또는 작업 영역)로 제한합니다.
 * 왼쪽·하단 모서리는 시작 시점 좌표로 고정해 접기/펼치기 때 우상단으로 밀리지 않게 합니다.
 * @param {number} [count]
 * @param {{ animate?: boolean }} [options]
 */
function resizeToContent(count, options = {}) {
  if (!floatWin || floatWin.isDestroyed()) return;
  const animate = Boolean(options.animate);
  const bounds = floatWin.getBounds();
  const display = screen.getDisplayMatching(bounds);
  const maxW = Math.min(FLOATING_MAX_WIDTH, Math.max(320, display.workArea.width - 24));
  const maxH = Math.max(120, display.workArea.height - 24);
  const collapsed = readFloatingSettings().collapsed;
  const fallbackW = Math.min(estimateFloatingWidth(count ?? listLauncherItems().length), maxW);
  // 가로 스크롤바·하단 패딩 포함 여유 높이 (접힘: 작은 핸들 알약)
  const fallbackH = collapsed ? 56 : 148;
  const minW = collapsed ? 48 : 200;
  const minH = collapsed ? 48 : 100;
  // 리사이즈 시작 시점의 왼쪽·하단 — 중간에 크기가 바뀌어도 이 기준을 유지
  const fixedLeft = bounds.x;
  const fixedBottom = bounds.y + bounds.height;

  const clampSize = (width, height) => ({
    width: Math.min(Math.max(Math.ceil(width), minW), maxW),
    height: Math.min(Math.max(Math.ceil(height), minH), maxH),
  });

  const apply = (width, height) => {
    if (!floatWin || floatWin.isDestroyed()) return;
    const next = clampSize(width, height);
    if (animate) {
      animateWindowSize(fixedLeft, fixedBottom, next.width, next.height, COLLAPSE_ANIM_MS);
      return;
    }
    if (resizeAnimTimer) {
      clearTimeout(resizeAnimTimer);
      resizeAnimTimer = null;
    }
    floatWin.setBounds({
      x: fixedLeft,
      y: Math.round(fixedBottom - next.height),
      width: next.width,
      height: next.height,
    });
  };

  // max-width:100% 때문에 작은 창에서 펼침 측정이 잘리면 애니메이션이 중간에 멈춤
  // → 측정 중 max-width 해제 + scrollWidth 우선
  const measureScript = `(() => {
    const bar = document.getElementById('bar');
    if (!bar) return null;
    const body = document.body;
    const cs = window.getComputedStyle(body);
    const padX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
    const padY = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    const prevMax = bar.style.maxWidth;
    bar.style.maxWidth = 'none';
    const barW = Math.max(bar.scrollWidth, bar.offsetWidth, bar.getBoundingClientRect().width);
    const barH = Math.max(bar.scrollHeight, bar.offsetHeight, bar.getBoundingClientRect().height);
    bar.style.maxWidth = prevMax;
    return { width: Math.ceil(barW + padX), height: Math.ceil(barH + padY) };
  })()`;

  if (animate) {
    // 애니메이션은 실측 한 번만 — 펼침 시 잘린 실측보다 예상 너비(fallback)를 하한으로
    void floatWin.webContents
      .executeJavaScript(measureScript)
      .then((size) => {
        if (!floatWin || floatWin.isDestroyed()) return;
        const w = collapsed
          ? size?.width || fallbackW
          : Math.max(size?.width || 0, fallbackW);
        const h = collapsed
          ? size?.height || fallbackH
          : Math.max(size?.height || 0, fallbackH);
        apply(w, h);
      })
      .catch(() => {
        apply(fallbackW, fallbackH);
      });
    return;
  }

  apply(fallbackW, fallbackH);

  // 렌더러가 그린 뒤 실측으로 한 번 더 맞춤 (좌표 기준은 위 fixedLeft/Bottom 유지)
  void floatWin.webContents
    .executeJavaScript(measureScript)
    .then((size) => {
      if (!size?.width || !floatWin || floatWin.isDestroyed()) return;
      if (collapsed) {
        apply(size.width, size.height || fallbackH);
      } else {
        apply(Math.max(size.width, fallbackW), Math.max(size.height || 0, fallbackH));
      }
    })
    .catch(() => undefined);
}

function showContextMenu() {
  if (!floatWin || floatWin.isDestroyed()) return;
  const settings = readFloatingSettings();
  const menu = Menu.buildFromTemplate([
    {
      label: settings.collapsed ? '펼치기' : '접기',
      click: () => {
        void setFloatingCollapsed(!settings.collapsed);
      },
    },
    { type: 'separator' },
    {
      label: '불투명도',
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
      label: '아이콘 열',
      submenu: [5, 7, 10].map((value) => ({
        label: `${value}열`,
        type: 'radio',
        checked: floatingPageSize(settings) === value,
        click: () => {
          void updateFloatingSettings({ columns: value }).then(() => {
            pushState();
            resizeToContent(listLauncherItems().length);
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
      label: '도움말 표시',
      type: 'checkbox',
      checked: !settings.hideHelp,
      click: (menuItem) => {
        void updateFloatingSettings({ hideHelp: !menuItem.checked }).then(() => {
          pushState();
          resizeToContent(listLauncherItems().length);
        });
      },
    },
    {
      label: '위치 초기화',
      click: () => {
        void resetFloatingPosition();
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
  // 높이 증가에 맞춰 하단 기준을 10px 위로 (작업 영역 하단에서 4px 위)
  const y = Math.round(work.y + work.height - bounds.height - 4);
  floatWin.setPosition(x, y);
}

/** 저장된 좌표를 지우고, 열려 있으면 기본 위치(하단 중앙)로 옮깁니다. */
export async function resetFloatingPosition() {
  await updateFloatingSettings({ x: null, y: null });
  if (floatWin && !floatWin.isDestroyed()) {
    placeDefault();
    pushState();
  }
  return { ok: true };
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

  ipcMain.on('floating-launcher:set-collapsed', (event, collapsed) => {
    if (!isFloatingLauncherSender(event)) return;
    void setFloatingCollapsed(Boolean(collapsed));
  });

  ipcMain.on('floating-launcher:set-hide-help', (event, hide) => {
    if (!isFloatingLauncherSender(event)) return;
    void updateFloatingSettings({ hideHelp: Boolean(hide) }).then(() => {
      pushState();
      resizeToContent(listLauncherItems().length);
    });
  });

  ipcMain.on('floating-launcher:resize', (event) => {
    if (!isFloatingLauncherSender(event)) return;
    resizeToContent(listLauncherItems().length);
  });
}

export function showFloatingLauncher() {
  bindIpcOnce();
  const settings = readFloatingSettings();
  const count = listLauncherItems().length;
  const display = screen.getPrimaryDisplay();
  const maxW = Math.min(FLOATING_MAX_WIDTH, Math.max(320, display.workArea.width - 24));
  const width = Math.min(estimateFloatingWidth(count), maxW);
  const height = 148;

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
