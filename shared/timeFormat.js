/**
 * 현재 시각 표시 — 24시간제 / 12시간제(오전·오후).
 */

/**
 * @param {number} n
 * @returns {string}
 */
function pad(n) {
  return String(n).padStart(2, '0');
}

/**
 * @param {Date} date
 * @param {{ hour12?: boolean, withSeconds?: boolean, compact?: boolean }} [options]
 * @returns {string}
 */
export function formatClockTime(date, options = {}) {
  const hour12 = Boolean(options.hour12);
  const withSeconds = options.withSeconds !== false;
  const compact = Boolean(options.compact);
  const minutes = pad(date.getMinutes());
  const seconds = pad(date.getSeconds());
  const h24 = date.getHours();

  if (!hour12) {
    const core = `${pad(h24)}:${minutes}`;
    return withSeconds ? `${core}:${seconds}` : core;
  }

  let h12 = h24 % 12;
  if (h12 === 0) h12 = 12;
  const core = `${h12}:${minutes}`;

  // 접힌 사이드바 등 좁은 칸: 줄바꿈·높이 증가 없이 2:05pm 형태
  if (compact) {
    const mark = h24 < 12 ? 'am' : 'pm';
    return withSeconds ? `${core}:${seconds}${mark}` : `${core}${mark}`;
  }

  const period = h24 < 12 ? '오전' : '오후';
  return withSeconds ? `${period} ${core}:${seconds}` : `${period} ${core}`;
}
