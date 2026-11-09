import { DEFAULT_ACCENT_COLOR, normalizeAccentColor } from '../shared/theme.js';
import { statePath } from './context.js';
import { readJsonSync, withFileLock, writeJsonSync } from './jsonStore.js';

const SETTINGS_FILE = 'settings.json';

/**
 * @typedef {{
 *   version: 1,
 *   accentColor: string,
 *   startupUpdateCheck: boolean,
 *   ffmpegDir: string,
 *   exportDir: string,
 * }} AppSettings
 */

/** @returns {AppSettings} */
function defaultSettings() {
  return {
    version: 1,
    accentColor: DEFAULT_ACCENT_COLOR,
    startupUpdateCheck: true,
    ffmpegDir: '',
    exportDir: '',
  };
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
    ffmpegDir: typeof src.ffmpegDir === 'string' ? src.ffmpegDir.trim() : base.ffmpegDir,
    exportDir: typeof src.exportDir === 'string' ? src.exportDir.trim() : base.exportDir,
  };
}

/** @type {AppSettings | null} */
let cache = null;

function load() {
  if (!cache) cache = normalizeSettings(readJsonSync(statePath(SETTINGS_FILE), {}));
  return cache;
}

/** @returns {AppSettings} */
export function getSettings() {
  return structuredClone(load());
}

/** Fields the renderer needs before anything else (theme + startup behaviour). */
export function getPublicSettings() {
  const { accentColor, startupUpdateCheck } = load();
  return { accentColor, startupUpdateCheck };
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
    cache = next;
    return structuredClone(next);
  });
}
