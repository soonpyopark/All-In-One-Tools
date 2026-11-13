/**
 * 사이드바·홈 바로가기 공통 메뉴 순서.
 * `home` 은 항상 맨 앞.
 * Windows 시스템 관리 바로 위는 `clock` → `subnet` 순으로 고정
 * (Windows 메뉴가 없으면 맨 아래), 나머지는 `orderIds` 순 → 등록 순.
 *
 * @template {{ id: string }} T
 * @param {T[]} features
 * @param {unknown} orderIds
 * @returns {T[]}
 */
export function orderFeatures(features, orderIds) {
  const list = Array.isArray(features) ? features : [];
  const home = list.find((feature) => feature.id === 'home');
  const clock = list.find((feature) => feature.id === 'clock');
  const subnet = list.find((feature) => feature.id === 'subnet');
  const rest = list.filter(
    (feature) => feature.id !== 'home' && feature.id !== 'clock' && feature.id !== 'subnet',
  );
  const byId = new Map(rest.map((feature) => [feature.id, feature]));
  /** @type {T[]} */
  const ordered = [];
  const seen = new Set();

  for (const raw of Array.isArray(orderIds) ? orderIds : []) {
    const id = String(raw ?? '');
    if (!id || id === 'home' || id === 'clock' || id === 'subnet' || seen.has(id)) continue;
    const feature = byId.get(id);
    if (!feature) continue;
    ordered.push(feature);
    seen.add(id);
  }
  for (const feature of rest) {
    if (seen.has(feature.id)) continue;
    ordered.push(feature);
  }

  /** @type {T[]} */
  const next = [];
  if (home) next.push(home);
  let tailPlaced = false;
  for (const feature of ordered) {
    if (feature.id === 'windows-system') {
      if (clock) next.push(clock);
      if (subnet) next.push(subnet);
      tailPlaced = true;
    }
    next.push(feature);
  }
  if (!tailPlaced) {
    if (clock) next.push(clock);
    if (subnet) next.push(subnet);
  }
  return next;
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
