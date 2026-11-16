/**
 * 사이드바·홈 바로가기 공통 메뉴 순서.
 * - `home` → `launcher` 항상 맨 앞 고정 (즐겨찾기 대상 아님)
 * - 그다음 즐겨찾기 메뉴
 * - 나머지는 `orderIds` 순 → 등록 순
 * - Windows 시스템 관리 바로 위는 (즐겨찾기 아닌) `clock` → `subnet` 고정
 */
export {
  PINNED_FEATURE_IDS,
  canFavoriteFeature,
  normalizeFeatureFavorites,
  normalizeFeatureOrder,
} from '../../shared/featureOrder.js';

import {
  PINNED_FEATURE_IDS,
  normalizeFeatureFavorites,
} from '../../shared/featureOrder.js';

/**
 * @template {{ id: string }} T
 * @param {T[]} features
 * @param {unknown} orderIds
 * @param {unknown} [favoriteIds]
 * @returns {T[]}
 */
export function orderFeatures(features, orderIds, favoriteIds = []) {
  const list = Array.isArray(features) ? features : [];
  const byId = new Map(list.map((feature) => [feature.id, feature]));
  const favSet = new Set(normalizeFeatureFavorites(favoriteIds).filter((id) => byId.has(id)));

  /** @type {T[]} */
  const pinned = [];
  for (const id of PINNED_FEATURE_IDS) {
    const feature = byId.get(id);
    if (feature) pinned.push(feature);
  }

  const clock = byId.get('clock');
  const subnet = byId.get('subnet');
  const clockPinnedTail = Boolean(clock) && !favSet.has('clock');
  const subnetPinnedTail = Boolean(subnet) && !favSet.has('subnet');

  const free = list.filter((feature) => {
    if (feature.id === 'home' || feature.id === 'launcher') return false;
    if (feature.id === 'clock' && clockPinnedTail) return false;
    if (feature.id === 'subnet' && subnetPinnedTail) return false;
    return true;
  });

  const freeById = new Map(free.map((feature) => [feature.id, feature]));
  /** @type {T[]} */
  const orderedFree = [];
  const seen = new Set();

  for (const raw of Array.isArray(orderIds) ? orderIds : []) {
    const id = String(raw ?? '');
    if (!id || id === 'home' || id === 'launcher' || seen.has(id)) continue;
    if ((id === 'clock' && clockPinnedTail) || (id === 'subnet' && subnetPinnedTail)) continue;
    const feature = freeById.get(id);
    if (!feature) continue;
    orderedFree.push(feature);
    seen.add(id);
  }
  for (const feature of free) {
    if (seen.has(feature.id)) continue;
    orderedFree.push(feature);
  }

  const favorites = orderedFree.filter((feature) => favSet.has(feature.id));
  const nonFav = orderedFree.filter((feature) => !favSet.has(feature.id));

  /** @type {T[]} */
  const restOut = [];
  let tailPlaced = false;
  for (const feature of nonFav) {
    if (feature.id === 'windows-system') {
      if (clockPinnedTail && clock) restOut.push(clock);
      if (subnetPinnedTail && subnet) restOut.push(subnet);
      tailPlaced = true;
    }
    restOut.push(feature);
  }
  if (!tailPlaced) {
    if (clockPinnedTail && clock) restOut.push(clock);
    if (subnetPinnedTail && subnet) restOut.push(subnet);
  }

  return [...pinned, ...favorites, ...restOut];
}
