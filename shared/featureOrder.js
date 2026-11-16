/**
 * 메뉴 순서·즐겨찾기 정규화 (메인·렌더러 공용).
 */

/** 홈·사이드바에서 항상 상단 고정 (별표 불가) */
export const PINNED_FEATURE_IDS = Object.freeze(['home', 'launcher']);

/** @param {string} id */
export function canFavoriteFeature(id) {
  const value = String(id ?? '');
  return Boolean(value) && value !== 'home' && value !== 'launcher';
}

/**
 * @param {unknown} raw
 * @returns {string[]}
 */
export function normalizeFeatureFavorites(raw) {
  if (!Array.isArray(raw)) return [];
  /** @type {string[]} */
  const out = [];
  const seen = new Set();
  for (const item of raw) {
    const id = String(item ?? '').trim();
    if (!id || !canFavoriteFeature(id) || seen.has(id) || !/^[a-z0-9-]{1,64}$/i.test(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= 64) break;
  }
  return out;
}

/**
 * @param {unknown} raw
 * @returns {string[]}
 */
export function normalizeFeatureOrder(raw) {
  if (!Array.isArray(raw)) return [];
  /** @type {string[]} */
  const out = [];
  const seen = new Set();
  for (const item of raw) {
    const id = String(item ?? '').trim();
    if (!id || id === 'home' || id === 'launcher' || seen.has(id) || !/^[a-z0-9-]{1,64}$/i.test(id)) {
      continue;
    }
    seen.add(id);
    out.push(id);
    if (out.length >= 64) break;
  }
  return out;
}
