import { randomUUID } from 'node:crypto';
import { PATH_FINDER_URL } from '../../shared/constants.js';
import { statePath } from '../context.js';
import { readJsonSync, withFileLock, writeJsonSync } from '../jsonStore.js';

const LAUNCHER_FILE = 'launcher.json';

/** 빌드에 포함하는 기본 바로가기 버전. 올리면 없는 항목만 한 번 더 합칩니다. */
const DEFAULTS_VERSION = 1;

/** @typedef {'app' | 'url' | 'folder' | 'file'} LauncherItemType */
/** @typedef {'work' | 'personal' | 'general'} LauncherGroup */

/**
 * @typedef {{
 *   id: string,
 *   type: LauncherItemType,
 *   title: string,
 *   target: string,
 *   icon: string,
 *   group: LauncherGroup,
 * }} LauncherItem
 */

const TYPE_ICONS = {
  app: '💻',
  url: '🌐',
  folder: '📁',
  file: '📄',
};

/** 앱 빌드에 포함되는 런처 기본 아이콘(바로가기). */
const BUILTIN_ITEMS = [
  {
    id: 'builtin-path-finder',
    type: 'url',
    title: '출장 경로 찾기',
    target: PATH_FINDER_URL,
    icon: '🗺️',
    group: 'work',
  },
];

/** @param {unknown} value @returns {value is LauncherItemType} */
function isType(value) {
  return value === 'app' || value === 'url' || value === 'folder' || value === 'file';
}

/** @param {unknown} value @returns {LauncherGroup} */
function normalizeGroup(value) {
  if (value === 'work' || value === 'personal' || value === 'general') return value;
  // 구버전·오타 보정
  const raw = String(value ?? '').trim().toLowerCase();
  if (raw === '업무' || raw === 'job' || raw === 'office') return 'work';
  if (raw === '개인' || raw === 'private' || raw === 'home') return 'personal';
  return 'general';
}

/**
 * @param {unknown} raw
 * @returns {LauncherItem | null}
 */
function normalizeItem(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const src = /** @type {Record<string, unknown>} */ (raw);
  const type = isType(src.type) ? src.type : null;
  if (!type) return null;

  const target = String(src.target ?? '').trim();
  if (!target || target.length > 2048) return null;

  if (type === 'url') {
    if (!/^https?:\/\//i.test(target)) return null;
  } else if (/[\u0000-\u001f]/.test(target)) {
    return null;
  }

  const title = String(src.title ?? '').trim().slice(0, 120) || defaultTitle(type, target);
  const iconRaw = String(src.icon ?? '').trim();
  const icon = iconRaw.slice(0, 32) || TYPE_ICONS[type];
  const group = normalizeGroup(src.group);
  const id =
    typeof src.id === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(src.id) ? src.id : randomUUID();

  return { id, type, title, target, icon, group };
}

/** @param {LauncherItemType} type @param {string} target */
function defaultTitle(type, target) {
  if (type === 'url') {
    try {
      return new URL(target).hostname || target;
    } catch {
      return target;
    }
  }
  const base = target.replace(/[\\/]+$/, '').split(/[\\/]/).pop();
  return base || target;
}

/**
 * 저장된 목록을 정규화합니다.
 * @param {unknown} raw
 * @returns {LauncherItem[]}
 */
function normalizeList(raw) {
  const list = Array.isArray(raw) ? raw : [];
  /** @type {LauncherItem[]} */
  const out = [];
  const seen = new Set();
  for (const item of list) {
    const next = normalizeItem(item);
    if (!next || seen.has(next.id)) continue;
    seen.add(next.id);
    out.push(next);
    if (out.length >= 200) break;
  }
  return out;
}

/**
 * @returns {{ items: LauncherItem[], defaultsVersion: number }}
 */
function readLauncherState() {
  const raw = readJsonSync(statePath(LAUNCHER_FILE), { items: [], defaultsVersion: 0 });
  return {
    items: normalizeList(raw?.items),
    defaultsVersion: Number(raw?.defaultsVersion) || 0,
  };
}

/**
 * @param {LauncherItem[]} items
 * @param {number} defaultsVersion
 */
function writeLauncherState(items, defaultsVersion) {
  writeJsonSync(statePath(LAUNCHER_FILE), {
    version: 1,
    defaultsVersion,
    items: items.slice(0, 200),
  });
}

/**
 * 빌드에 심어 둔 기본 바로가기를 한 번 합칩니다. (이미 있거나 사용자가 지운 뒤에는 다시 넣지 않음)
 * @returns {{ items: LauncherItem[], defaultsVersion: number }}
 */
function ensureBuiltinDefaultsUnlocked() {
  const state = readLauncherState();
  if (state.defaultsVersion >= DEFAULTS_VERSION) return state;

  const seen = new Set(state.items.map((item) => item.id));
  const merged = [...state.items];
  for (const builtin of BUILTIN_ITEMS) {
    const next = normalizeItem(builtin);
    if (!next || seen.has(next.id)) continue;
    seen.add(next.id);
    merged.unshift(next);
  }
  const items = merged.slice(0, 200);
  writeLauncherState(items, DEFAULTS_VERSION);
  return { items, defaultsVersion: DEFAULTS_VERSION };
}

/** @returns {LauncherItem[]} */
export function listLauncherItems() {
  return ensureBuiltinDefaultsUnlocked().items;
}

/**
 * @param {unknown[]} items
 * @returns {Promise<LauncherItem[]>}
 */
export function saveLauncherItems(items) {
  return withFileLock(statePath(LAUNCHER_FILE), () => {
    const next = normalizeList(items);
    const prev = readLauncherState();
    writeLauncherState(next, Math.max(prev.defaultsVersion, DEFAULTS_VERSION));
    return next;
  });
}

/**
 * @param {unknown} raw
 * @returns {Promise<LauncherItem[]>}
 */
export function upsertLauncherItem(raw) {
  return withFileLock(statePath(LAUNCHER_FILE), () => {
    const item = normalizeItem(raw);
    if (!item) throw new Error('바로가기 정보가 올바르지 않습니다.');
    const state = ensureBuiltinDefaultsUnlocked();
    const current = [...state.items];
    const index = current.findIndex((entry) => entry.id === item.id);
    if (index >= 0) current[index] = item;
    else current.push(item);
    const next = current.slice(0, 200);
    writeLauncherState(next, Math.max(state.defaultsVersion, DEFAULTS_VERSION));
    return next;
  });
}

/**
 * @param {string} id
 * @returns {Promise<LauncherItem[]>}
 */
export function removeLauncherItem(id) {
  return withFileLock(statePath(LAUNCHER_FILE), () => {
    const state = ensureBuiltinDefaultsUnlocked();
    const next = state.items.filter((item) => item.id !== id);
    writeLauncherState(next, Math.max(state.defaultsVersion, DEFAULTS_VERSION));
    return next;
  });
}

export { TYPE_ICONS };