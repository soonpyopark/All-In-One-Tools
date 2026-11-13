/**
 * 런처 아이콘 배경 팔레트 (메인 카드·플로팅 공통).
 */

/**
 * @typedef {{ id: string, label: string, from: string, to: string }} LauncherColorSwatch
 */

/** @type {LauncherColorSwatch[]} */
export const LAUNCHER_COLOR_PALETTE = [
  { id: 'rose', label: '로즈', from: '#f472b6', to: '#ef4444' },
  { id: 'amber', label: '앰버', from: '#fbbf24', to: '#f97316' },
  { id: 'green', label: '그린', from: '#4ade80', to: '#16a34a' },
  { id: 'sky', label: '스카이', from: '#38bdf8', to: '#2563eb' },
  { id: 'violet', label: '바이올렛', from: '#a78bfa', to: '#7c3aed' },
  { id: 'cyan', label: '시안', from: '#22d3ee', to: '#0891b2' },
  { id: 'orange', label: '오렌지', from: '#fb923c', to: '#c2410c' },
  { id: 'pink', label: '핑크', from: '#f9a8d4', to: '#db2777' },
  { id: 'lime', label: '라임', from: '#a3e635', to: '#65a30d' },
  { id: 'indigo', label: '인디고', from: '#818cf8', to: '#4338ca' },
  { id: 'teal', label: '틸', from: '#2dd4bf', to: '#0f766e' },
  { id: 'slate', label: '슬레이트', from: '#94a3b8', to: '#334155' },
];

export const DEFAULT_LAUNCHER_COLOR = 'slate';

/** @type {Map<string, LauncherColorSwatch>} */
const BY_ID = new Map(LAUNCHER_COLOR_PALETTE.map((swatch) => [swatch.id, swatch]));

/**
 * @param {unknown} value
 * @returns {value is string}
 */
export function isLauncherColorId(value) {
  return typeof value === 'string' && BY_ID.has(value);
}

/**
 * @param {unknown} value
 * @param {string} [fallbackId]
 */
export function normalizeLauncherColorId(value, fallbackId = DEFAULT_LAUNCHER_COLOR) {
  const id = String(value ?? '').trim();
  if (BY_ID.has(id)) return id;
  return BY_ID.has(fallbackId) ? fallbackId : DEFAULT_LAUNCHER_COLOR;
}

/**
 * 색이 비어 있을 때 항목 id 로 고른 기본값 (기존 항목도 매번 같은 색).
 * @param {string} itemId
 */
export function launcherColorIdFromItemId(itemId) {
  const text = String(itemId ?? '');
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash + text.charCodeAt(i) * (i + 1)) % LAUNCHER_COLOR_PALETTE.length;
  }
  return LAUNCHER_COLOR_PALETTE[hash]?.id ?? DEFAULT_LAUNCHER_COLOR;
}

/**
 * @param {unknown} colorId
 * @returns {LauncherColorSwatch}
 */
export function resolveLauncherColor(colorId) {
  const id = normalizeLauncherColorId(colorId);
  return BY_ID.get(id) ?? /** @type {LauncherColorSwatch} */ (BY_ID.get(DEFAULT_LAUNCHER_COLOR));
}

/**
 * @param {unknown} colorId
 * @returns {string}
 */
export function launcherColorGradient(colorId) {
  const swatch = resolveLauncherColor(colorId);
  return `linear-gradient(145deg, ${swatch.from}, ${swatch.to})`;
}

/**
 * 플로팅 UI 등에서 바로 쓸 수 있게 from/to 를 붙입니다.
 * @template {{ color?: string }} T
 * @param {T[]} items
 * @returns {(T & { colorFrom: string, colorTo: string })[]}
 */
export function decorateLauncherItemsForUi(items) {
  const list = Array.isArray(items) ? items : [];
  return list.map((item) => {
    const swatch = resolveLauncherColor(item?.color);
    return { ...item, colorFrom: swatch.from, colorTo: swatch.to };
  });
}
