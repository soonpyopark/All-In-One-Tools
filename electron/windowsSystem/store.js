/**
 * Windows 시스템 관리 바로가기 순서 저장.
 */
import { statePath } from '../context.js';
import { readJsonSync, withFileLock, writeJsonSync } from '../jsonStore.js';
import { normalizeWindowsSystemOrder } from '../../shared/windowsSystem.js';

const STORE_FILE = 'windows-system.json';

function storePath() {
  return statePath(STORE_FILE);
}

/**
 * @returns {{ order: string[] }}
 */
export function readWindowsSystemState() {
  const raw = readJsonSync(storePath(), {});
  return { order: normalizeWindowsSystemOrder(raw?.order) };
}

/**
 * @param {unknown} order
 * @returns {Promise<{ order: string[] }>}
 */
export function saveWindowsSystemOrder(order) {
  const file = storePath();
  return withFileLock(file, () => {
    const next = { order: normalizeWindowsSystemOrder(order) };
    writeJsonSync(file, next);
    return next;
  });
}
