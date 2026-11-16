/**
 * 프로그램·파일·폴더의 OS 아이콘을 추출해 런처 UI용 data URL 로 제공합니다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { decorateLauncherItemsForUi } from '../../shared/launcherColors.js';
import { statePath } from '../context.js';
import { listLauncherItems } from './store.js';

/** @type {Map<string, { target: string, dataUrl: string }>} */
const memoryCache = new Map();

function cacheDir() {
  return statePath('launcher-icons');
}

/** @param {string} id */
function cacheFileFor(id) {
  const safe = String(id).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64);
  return path.join(cacheDir(), `${safe}.png`);
}

/**
 * @param {{ type?: string, target?: string }} item
 */
function canExtractFileIcon(item) {
  const type = item?.type;
  if (type !== 'app' && type !== 'file' && type !== 'folder') return false;
  const target = String(item?.target ?? '').trim();
  if (!target || /^https?:\/\//i.test(target)) return false;
  return true;
}

/**
 * @param {string} id
 */
export function clearLauncherIconCache(id) {
  const key = String(id ?? '').trim();
  if (!key) return;
  memoryCache.delete(key);
  try {
    fs.rmSync(cacheFileFor(key), { force: true });
  } catch {
    /* ignore */
  }
}

/**
 * @param {{ id: string, type: string, target: string }} item
 * @returns {Promise<string>} data URL 또는 빈 문자열
 */
export async function resolveLauncherIconImage(item) {
  if (!canExtractFileIcon(item)) return '';
  const id = String(item.id ?? '').trim();
  const target = path.resolve(String(item.target).trim());
  if (!id || !target) return '';

  const mem = memoryCache.get(id);
  if (mem && mem.target === target) return mem.dataUrl;

  if (!fs.existsSync(target)) {
    memoryCache.delete(id);
    return '';
  }

  const disk = cacheFileFor(id);
  try {
    if (fs.existsSync(disk)) {
      const stTarget = fs.statSync(target);
      const stCache = fs.statSync(disk);
      // 대상이 캐시보다 오래되지 않았으면 캐시 사용 (대상 mtime <= 캐시 mtime)
      if (stTarget.mtimeMs <= stCache.mtimeMs) {
        const buf = fs.readFileSync(disk);
        const dataUrl = `data:image/png;base64,${buf.toString('base64')}`;
        memoryCache.set(id, { target, dataUrl });
        return dataUrl;
      }
    }
  } catch {
    /* 다시 추출 */
  }

  try {
    const image = await app.getFileIcon(target, { size: 'large' });
    if (!image || image.isEmpty()) return '';
    const sized = image.resize({ width: 48, height: 48, quality: 'best' });
    const png = sized.toPNG();
    fs.mkdirSync(cacheDir(), { recursive: true });
    fs.writeFileSync(disk, png);
    const dataUrl = `data:image/png;base64,${png.toString('base64')}`;
    memoryCache.set(id, { target, dataUrl });
    return dataUrl;
  } catch {
    return '';
  }
}

/**
 * @template {{ id: string, type: string, target: string }} T
 * @param {T[]} items
 * @returns {Promise<(T & { iconImage?: string })[]>}
 */
export async function attachFileIcons(items) {
  const list = Array.isArray(items) ? items : [];
  return Promise.all(
    list.map(async (item) => {
      const iconImage = await resolveLauncherIconImage(item);
      if (!iconImage) return { ...item };
      return { ...item, iconImage };
    }),
  );
}

/**
 * 색상 장식 + 파일 아이콘을 붙인 UI용 목록.
 * @param {import('./store.js').LauncherItem[] | undefined} [items]
 */
export async function presentLauncherItems(items) {
  const base = decorateLauncherItemsForUi(Array.isArray(items) ? items : listLauncherItems());
  return attachFileIcons(base);
}
