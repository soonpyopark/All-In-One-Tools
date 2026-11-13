/**
 * 플로팅 런처 창 위치·표시 옵션 저장.
 * 마지막에 쓰던 위치·불투명도·항상 위·호버 선명 값을 다음에 그대로 불러옵니다.
 */
import { statePath } from '../context.js';
import { readJsonSync, withFileLock, writeJsonSync } from '../jsonStore.js';

const STORE_FILE = 'floating-launcher.json';

/**
 * @typedef {{
 *   x: number | null,
 *   y: number | null,
 *   opacity: number,
 *   sharpenOnHover: boolean,
 *   alwaysOnTop: boolean,
 *   collapsed: boolean,
 *   hideHelp: boolean,
 *   columns: 5 | 7 | 10,
 * }} FloatingLauncherSettings
 */

/** @returns {FloatingLauncherSettings} */
function defaults() {
  return {
    x: null,
    y: null,
    opacity: 1,
    sharpenOnHover: true,
    alwaysOnTop: true,
    collapsed: false,
    hideHelp: false,
    columns: 5,
  };
}

/**
 * @param {unknown} raw
 * @returns {FloatingLauncherSettings}
 */
function normalize(raw) {
  const base = defaults();
  const src = raw && typeof raw === 'object' ? /** @type {Record<string, unknown>} */ (raw) : {};
  const opacity = Number(src.opacity);
  const hasX = src.x != null && src.x !== '' && Number.isFinite(Number(src.x));
  const hasY = src.y != null && src.y !== '' && Number.isFinite(Number(src.y));
  // x·y 둘 다 있어야 복원. 한쪽만 있으면 기본 위치로.
  return {
    x: hasX && hasY ? Math.round(Number(src.x)) : null,
    y: hasX && hasY ? Math.round(Number(src.y)) : null,
    opacity: Number.isFinite(opacity) ? Math.min(1, Math.max(0.35, opacity)) : base.opacity,
    sharpenOnHover: src.sharpenOnHover !== false,
    alwaysOnTop: src.alwaysOnTop !== false,
    collapsed: src.collapsed === true,
    hideHelp: src.hideHelp === true,
    columns: [5, 7, 10].includes(Number(src.columns)) ? /** @type {5|7|10} */ (Number(src.columns)) : 5,
  };
}

function storePath() {
  return statePath(STORE_FILE);
}

/** @returns {FloatingLauncherSettings} */
export function readFloatingSettings() {
  return normalize(readJsonSync(storePath(), {}));
}

/**
 * @param {Partial<FloatingLauncherSettings>} patch
 * @returns {Promise<FloatingLauncherSettings>}
 */
export function updateFloatingSettings(patch) {
  const file = storePath();
  return withFileLock(file, () => {
    const next = normalize({ ...readFloatingSettings(), ...patch });
    writeJsonSync(file, next);
    return next;
  });
}
