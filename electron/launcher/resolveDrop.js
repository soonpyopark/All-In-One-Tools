/**
 * 탐색기·바탕화면에서 끌어다 놓은 경로를 런처 항목(종류·제목·대상)으로 해석합니다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { shell } from 'electron';

const APP_EXTS = new Set(['.exe', '.bat', '.cmd', '.com', '.msi', '.ps1']);

/**
 * @param {string} filePath
 * @returns {string | null}
 */
function readInternetShortcutUrl(filePath) {
  let text = '';
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
  const match = /^\s*URL\s*=\s*(.+)\s*$/im.exec(text);
  if (!match) return null;
  const url = String(match[1] ?? '').trim();
  return /^https?:\/\//i.test(url) ? url : null;
}

/**
 * @param {string} target
 * @returns {'app' | 'folder' | 'file' | 'url'}
 */
function classifyResolvedTarget(target) {
  const trimmed = String(target ?? '').trim();
  if (/^https?:\/\//i.test(trimmed)) return 'url';
  try {
    const st = fs.statSync(trimmed);
    if (st.isDirectory()) return 'folder';
  } catch {
    // 대상이 없어도 확장자로 추정
  }
  const ext = path.extname(trimmed).toLowerCase();
  if (APP_EXTS.has(ext)) return 'app';
  return 'file';
}

/**
 * @param {string} filePath
 * @returns {string}
 */
function titleFromPath(filePath) {
  const base = path.basename(filePath);
  const ext = path.extname(base);
  const stem = ext ? base.slice(0, -ext.length) : base;
  return (stem || base || filePath).slice(0, 120);
}

/**
 * @param {string} inputPath
 * @returns {{ type: 'app' | 'url' | 'folder' | 'file', title: string, target: string }}
 */
export function resolveDroppedPath(inputPath) {
  const resolved = path.resolve(String(inputPath ?? '').trim());
  if (!resolved) throw new Error('경로가 비어 있습니다.');
  if (!fs.existsSync(resolved)) throw new Error(`찾을 수 없습니다: ${resolved}`);

  const ext = path.extname(resolved).toLowerCase();
  const title = titleFromPath(resolved);

  // Windows 인터넷 바로가기 (.url)
  if (ext === '.url') {
    const url = readInternetShortcutUrl(resolved);
    if (!url) throw new Error(`URL 바로가기를 읽지 못했습니다: ${path.basename(resolved)}`);
    return { type: 'url', title, target: url };
  }

  // Windows 바로가기 (.lnk)
  if (ext === '.lnk') {
    if (process.platform !== 'win32' || typeof shell.readShortcutLink !== 'function') {
      throw new Error('이 환경에서는 .lnk 바로가기를 해석할 수 없습니다.');
    }
    let link;
    try {
      link = shell.readShortcutLink(resolved);
    } catch (err) {
      throw new Error(
        err instanceof Error ? err.message : `.lnk 해석 실패: ${path.basename(resolved)}`,
      );
    }
    const target = String(link?.target ?? '').trim();
    if (!target) throw new Error(`바로가기 대상이 없습니다: ${path.basename(resolved)}`);
    const type = classifyResolvedTarget(target);
    return { type, title, target };
  }

  const st = fs.statSync(resolved);
  if (st.isDirectory()) {
    return { type: 'folder', title, target: resolved };
  }

  const type = APP_EXTS.has(ext) ? 'app' : 'file';
  return { type, title, target: resolved };
}
