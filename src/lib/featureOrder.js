/**
 * 사이드바·홈 바로가기 공통 메뉴 순서.
 * `home` 은 항상 맨 앞, 나머지는 `orderIds` 순 → 등록 순(미포함 항목).
 *
 * @template {{ id: string }} T
 * @param {T[]} features
 * @param {unknown} orderIds
 * @returns {T[]}
 */
export function orderFeatures(features, orderIds) {
  const list = Array.isArray(features) ? features : [];
  const home = list.find((feature) => feature.id === 'home');
  const rest = list.filter((feature) => feature.id !== 'home');
  const byId = new Map(rest.map((feature) => [feature.id, feature]));
  /** @type {T[]} */
  const ordered = [];
  const seen = new Set();

  for (const raw of Array.isArray(orderIds) ? orderIds : []) {
    const id = String(raw ?? '');
    if (!id || id === 'home' || seen.has(id)) continue;
    const feature = byId.get(id);
    if (!feature) continue;
    ordered.push(feature);
    seen.add(id);
  }
  for (const feature of rest) {
    if (seen.has(feature.id)) continue;
    ordered.push(feature);
  }

  return home ? [home, ...ordered] : ordered;
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
    if (!id || id === 'home' || seen.has(id) || !/^[a-z0-9-]{1,64}$/i.test(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= 64) break;
  }
  return out;
}
