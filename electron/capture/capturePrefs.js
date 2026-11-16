/**
 * 캡처에서 마지막으로 고른 모니터를 기억합니다.
 * display.id 는 재연결 시 바뀔 수 있어 bounds 로도 맞춥니다.
 */
import { screen } from 'electron';
import { statePath } from '../context.js';
import { readJsonSync, withFileLock, writeJsonSync } from '../jsonStore.js';

const PREFS_FILE = 'capture-prefs.json';

/**
 * @typedef {{
 *   lastDisplayId: number | null,
 *   lastDisplayBounds: { x: number, y: number, width: number, height: number } | null,
 * }} CapturePrefs
 */

/** @returns {CapturePrefs} */
function defaults() {
  return { lastDisplayId: null, lastDisplayBounds: null };
}

/**
 * @param {unknown} raw
 * @returns {CapturePrefs}
 */
function normalize(raw) {
  const src = raw && typeof raw === 'object' ? /** @type {Record<string, unknown>} */ (raw) : {};
  const id = Number(src.lastDisplayId);
  const b = src.lastDisplayBounds && typeof src.lastDisplayBounds === 'object'
    ? /** @type {Record<string, unknown>} */ (src.lastDisplayBounds)
    : null;
  return {
    lastDisplayId: Number.isFinite(id) ? id : null,
    lastDisplayBounds: b
      ? {
          x: Math.round(Number(b.x) || 0),
          y: Math.round(Number(b.y) || 0),
          width: Math.round(Number(b.width) || 0),
          height: Math.round(Number(b.height) || 0),
        }
      : null,
  };
}

/** @returns {CapturePrefs} */
export function readCapturePrefs() {
  return normalize(readJsonSync(statePath(PREFS_FILE), {}));
}

/**
 * @param {Partial<CapturePrefs>} patch
 * @returns {Promise<CapturePrefs>}
 */
export function updateCapturePrefs(patch) {
  const file = statePath(PREFS_FILE);
  return withFileLock(file, () => {
    const next = normalize({ ...readCapturePrefs(), ...patch });
    writeJsonSync(file, next);
    return next;
  });
}

/**
 * @param {import('electron').Display} display
 */
function boundsOf(display) {
  return {
    x: display.bounds.x,
    y: display.bounds.y,
    width: display.bounds.width,
    height: display.bounds.height,
  };
}

/**
 * @param {import('electron').Display} display
 * @param {{ x: number, y: number, width: number, height: number } | null} bounds
 */
function boundsMatch(display, bounds) {
  if (!bounds || bounds.width < 1 || bounds.height < 1) return false;
  const b = display.bounds;
  return b.x === bounds.x && b.y === bounds.y && b.width === bounds.width && b.height === bounds.height;
}

/**
 * 모니터를 기억합니다 (id + 위치).
 * @param {number | null | undefined} displayId
 */
export async function rememberCaptureDisplay(displayId) {
  const displays = screen.getAllDisplays();
  const idNum = displayId == null || displayId === '' ? NaN : Number(displayId);
  const display =
    Number.isFinite(idNum) ? displays.find((d) => Number(d.id) === idNum) : undefined;
  if (!display) return readCapturePrefs();
  return updateCapturePrefs({
    lastDisplayId: Number(display.id),
    lastDisplayBounds: boundsOf(display),
  });
}

/**
 * 저장된 id → bounds → 주 모니터 순으로 현재 모니터 id 를 고릅니다.
 * @param {number | null | undefined} preferredId
 * @returns {number}
 */
export function resolveCaptureDisplayId(preferredId) {
  const displays = screen.getAllDisplays();
  const primary = screen.getPrimaryDisplay();
  const prefs = readCapturePrefs();
  const tryId = preferredId != null && preferredId !== '' ? Number(preferredId) : NaN;

  if (Number.isFinite(tryId)) {
    const found = displays.find((d) => Number(d.id) === tryId);
    if (found) return Number(found.id);
  }

  if (prefs.lastDisplayId != null) {
    const found = displays.find((d) => Number(d.id) === Number(prefs.lastDisplayId));
    if (found) return Number(found.id);
  }

  if (prefs.lastDisplayBounds) {
    const found = displays.find((d) => boundsMatch(d, prefs.lastDisplayBounds));
    if (found) return Number(found.id);
  }

  return Number(primary.id);
}
