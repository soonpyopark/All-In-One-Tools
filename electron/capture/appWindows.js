import { BrowserWindow } from 'electron';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 캡처에 앱 창이 찍히지 않도록 보이는 앱 창을 최소화합니다.
 * @returns {Promise<BrowserWindow[]>} 나중에 `restoreAppWindows` 로 되돌릴 창 목록
 */
export async function hideAppWindows() {
  const hidden = BrowserWindow.getAllWindows().filter(
    (win) => !win.isDestroyed() && win.isVisible() && !win.isMinimized(),
  );
  for (const win of hidden) win.minimize();
  // 최소화 애니메이션이 끝나야 화면에 안 찍힙니다.
  if (hidden.length > 0) await sleep(400);
  return hidden;
}

/** @param {BrowserWindow[]} windows */
export function restoreAppWindows(windows) {
  for (const win of windows) {
    if (win.isDestroyed()) continue;
    win.restore();
    win.focus();
  }
}
