import fs from 'node:fs';
import { DEFAULT_ACCENT_COLOR, normalizeAccentColor } from '../shared/theme.js';
import { statePath } from './context.js';
import { readJsonSync, withFileLock, writeJsonSync } from './jsonStore.js';

const SETTINGS_FILE = 'settings.json';

/**
 * @typedef {{
 *   version: 1,
 *   accentColor: string,
 *   startupUpdateCheck: boolean,
 *   closeToTray: boolean,
 *   floatingLauncherOnStart: boolean,
 *   ffmpegDir: string,
 *   exportDir: string,
 *   folders: Record<string, string>,
 *   featureOrder: string[],
 * }} AppSettings
 */

/** @returns {AppSettings} */
function defaultSettings() {
  return {
    version: 1,
    accentColor: DEFAULT_ACCENT_COLOR,
    startupUpdateCheck: true,
    closeToTray: false,
    floatingLauncherOnStart: true,
    ffmpegDir: '',
    exportDir: '',
    folders: {},
    featureOrder: [],
  };
}

/**
 * 홈·사이드바 메뉴 id 순서. `home` 은 저장하지 않는다.
 * @param {unknown} raw
 * @returns {string[]}
 */
function normalizeFeatureOrder(raw) {
  if (!Array.isArray(raw)) return [];
  /** @type {string[]} */
  const out = [];
  const seen = new Set();
  for (const item of raw) {
    const id = String(item ?? '').trim();
    if (!id || id === 'home' || seen.has(id) || !/^[A-Za-z0-9-]{1,64}$/.test(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= 64) break;
  }
  return out;
}

/** Keys of the remembered folders (see `rememberFolder`). */
const FOLDER_KEY = /^[A-Za-z][A-Za-z0-9]{0,31}$/;
const MAX_FOLDERS = 40;

/** @param {any} raw @returns {Record<string, string>} */
function normalizeFolders(raw) {
  /** @type {Record<string, string>} */
  const result = {};
  if (!raw || typeof raw !== 'object') return result;
  for (const [key, value] of Object.entries(raw)) {
    if (Object.keys(result).length >= MAX_FOLDERS) break;
    if (FOLDER_KEY.test(key) && typeof value === 'string') result[key] = value.trim();
  }
  return result;
}

/**
 * Coerces anything read from disk / the API into a valid settings object.
 * Unknown keys (including settings of removed features) are dropped, so a new
 * setting must be added here.
 *
 * @param {any} raw
 * @returns {AppSettings}
 */
function normalizeSettings(raw) {
  const base = defaultSettings();
  const src = raw && typeof raw === 'object' ? raw : {};
  return {
    version: 1,
    accentColor: normalizeAccentColor(src.accentColor, base.accentColor),
    startupUpdateCheck: src.startupUpdateCheck !== false,
    closeToTray: src.closeToTray === true,
    // 기본값 켜짐. 사용자가 끄기 전에는 시작 시 플로팅을 엽니다.
    floatingLauncherOnStart: src.floatingLauncherOnStart !== false,
    ffmpegDir: typeof src.ffmpegDir === 'string' ? src.ffmpegDir.trim() : base.ffmpegDir,
    exportDir: typeof src.exportDir === 'string' ? src.exportDir.trim() : base.exportDir,
    folders: normalizeFolders(src.folders),
    featureOrder: normalizeFeatureOrder(src.featureOrder),
  };
}

/** Always read from disk: several program instances may share one settings file. */
function load() {
  return normalizeSettings(readJsonSync(statePath(SETTINGS_FILE), {}));
}

/** @returns {AppSettings} */
export function getSettings() {
  return structuredClone(load());
}

/** Fields the renderer needs before anything else (theme + startup behaviour). */
export function getPublicSettings() {
  const { accentColor, startupUpdateCheck, closeToTray } = load();
  return { accentColor, startupUpdateCheck, closeToTray };
}

/**
 * Shallow-merges `patch` and persists.
 *
 * @param {Partial<AppSettings>} patch
 * @returns {Promise<AppSettings>}
 */
export function updateSettings(patch) {
  return withFileLock(statePath(SETTINGS_FILE), () => {
    const current = load();
    const next = normalizeSettings({ ...current, ...patch });
    writeJsonSync(statePath(SETTINGS_FILE), next);
    return structuredClone(next);
  });
}

/**
 * Folder last used for `key` (e.g. 'convertInput', 'cleanupOutput'); '' when
 * nothing was remembered yet or the folder no longer exists.
 *
 * @param {string} key
 * @returns {string}
 */
export function getRememberedFolder(key) {
  const dir = load().folders[String(key ?? '')] ?? '';
  try {
    return dir && fs.statSync(dir).isDirectory() ? dir : '';
  } catch {
    return '';
  }
}

/**
 * Remembers the folder for `key`; an empty `dir` forgets it.
 *
 * @param {string} key
 * @param {string} dir
 */
export async function rememberFolder(key, dir) {
  const name = String(key ?? '');
  if (!FOLDER_KEY.test(name)) return;
  const value = String(dir ?? '').trim();
  await withFileLock(statePath(SETTINGS_FILE), () => {
    const current = load();
    if ((current.folders[name] ?? '') === value) return;
    writeJsonSync(
      statePath(SETTINGS_FILE),
      normalizeSettings({ ...current, folders: { ...current.folders, [name]: value } }),
    );
  });
}