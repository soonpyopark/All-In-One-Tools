/**
 * 파일·폴더 경로를 확장해 지원 확장자 파일 목록으로 만든다.
 */
import fs from 'node:fs';
import path from 'node:path';

export const MAX_INSPECT_FILES = 20_000;

/**
 * @param {string[]} [exts] `.mp4` 형식. 비어 있으면 모든 파일.
 * @returns {Set<string>}
 */
function normalizeExtSet(exts) {
  const set = new Set();
  for (const raw of Array.isArray(exts) ? exts : []) {
    const ext = String(raw).trim().toLowerCase();
    if (!ext) continue;
    set.add(ext.startsWith('.') ? ext : `.${ext}`);
  }
  return set;
}

/**
 * @param {string} filePath
 * @param {Set<string>} extSet
 */
function matchesExt(filePath, extSet) {
  if (extSet.size === 0) return true;
  return extSet.has(path.extname(filePath).toLowerCase());
}

/**
 * @param {string} root
 * @param {boolean} recursive
 * @param {Set<string>} extSet
 * @param {{ truncated: boolean }} state
 * @param {string[]} out
 */
function collectFromDir(root, recursive, extSet, state, out) {
  const stack = [root];
  while (stack.length > 0 && !state.truncated) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (state.truncated) break;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (recursive) stack.push(full);
        continue;
      }
      if (!entry.isFile() || !matchesExt(full, extSet)) continue;
      out.push(full);
      if (out.length >= MAX_INSPECT_FILES) state.truncated = true;
    }
  }
}

/**
 * @param {{
 *   paths?: unknown,
 *   recursive?: boolean,
 *   exts?: unknown,
 * }} body
 * @returns {{
 *   files: Array<{ path: string, name: string, dir: string, size: number }>,
 *   skipped: number,
 *   truncated: boolean,
 * }}
 */
export function inspectPaths(body = {}) {
  const rawPaths = Array.isArray(body.paths) ? body.paths : [];
  const recursive = body.recursive === true;
  const extSet = normalizeExtSet(body.exts);
  /** @type {string[]} */
  const found = [];
  let skipped = 0;
  const state = { truncated: false };

  for (const raw of rawPaths) {
    if (state.truncated) break;
    const target = path.resolve(String(raw ?? ''));
    if (!target) {
      skipped += 1;
      continue;
    }
    try {
      const stat = fs.statSync(target);
      if (stat.isDirectory()) {
        collectFromDir(target, recursive, extSet, state, found);
      } else if (stat.isFile()) {
        if (matchesExt(target, extSet)) found.push(target);
        else skipped += 1;
      } else {
        skipped += 1;
      }
    } catch {
      skipped += 1;
    }
  }

  const unique = [...new Set(found)];
  const collator = new Intl.Collator('ko', { numeric: true, sensitivity: 'base' });
  unique.sort((a, b) => collator.compare(path.basename(a), path.basename(b)) || collator.compare(a, b));

  const files = [];
  for (const filePath of unique) {
    try {
      files.push({
        path: filePath,
        name: path.basename(filePath),
        dir: path.dirname(filePath),
        size: fs.statSync(filePath).size,
      });
    } catch {
      skipped += 1;
    }
  }

  return { files, skipped, truncated: state.truncated };
}
