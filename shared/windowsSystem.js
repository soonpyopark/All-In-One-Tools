/**
 * Windows 시스템 관리 — 바로가기 정의 (메인·렌더러 공용).
 * Windows(win32) 빌드에서만 메뉴로 노출합니다.
 */

/** @typedef {'control-panel' | 'computer-management' | 'services' | 'schedule'} WindowsSystemShortcutId */

/**
 * @typedef {{
 *   id: WindowsSystemShortcutId,
 *   label: string,
 *   icon: string,
 *   description: string,
 * }} WindowsSystemShortcut
 */

/** @type {WindowsSystemShortcut[]} */
export const WINDOWS_SYSTEM_SHORTCUTS = [
  {
    id: 'control-panel',
    label: '제어판',
    icon: '⚙️',
    description: 'Windows 제어판을 엽니다.',
  },
  {
    id: 'computer-management',
    label: '컴퓨터관리',
    icon: '🖥️',
    description: '컴퓨터 관리(디스크·사용자·이벤트 등)를 엽니다.',
  },
  {
    id: 'services',
    label: '서비스',
    icon: '🔧',
    description: 'Windows 서비스 관리자를 엽니다.',
  },
  {
    id: 'schedule',
    label: '작업 스케줄러',
    icon: '📅',
    description: '작업 스케줄러를 엽니다.',
  },
];

/** @type {WindowsSystemShortcutId[]} */
export const WINDOWS_SYSTEM_SHORTCUT_IDS = WINDOWS_SYSTEM_SHORTCUTS.map((item) => item.id);

/**
 * @param {unknown} raw
 * @returns {WindowsSystemShortcutId[]}
 */
export function normalizeWindowsSystemOrder(raw) {
  const allowed = new Set(WINDOWS_SYSTEM_SHORTCUT_IDS);
  /** @type {WindowsSystemShortcutId[]} */
  const out = [];
  const seen = new Set();
  for (const item of Array.isArray(raw) ? raw : []) {
    const id = /** @type {WindowsSystemShortcutId} */ (String(item ?? ''));
    if (!allowed.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  for (const id of WINDOWS_SYSTEM_SHORTCUT_IDS) {
    if (seen.has(id)) continue;
    out.push(id);
  }
  return out;
}

/**
 * @param {unknown} orderIds
 * @returns {WindowsSystemShortcut[]}
 */
export function orderWindowsSystemShortcuts(orderIds) {
  const byId = new Map(WINDOWS_SYSTEM_SHORTCUTS.map((item) => [item.id, item]));
  return normalizeWindowsSystemOrder(orderIds)
    .map((id) => byId.get(id))
    .filter(Boolean);
}
