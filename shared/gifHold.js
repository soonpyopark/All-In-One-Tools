/** 첫 프레임·마지막 프레임을 붙잡아 두는 시간(초) 기본값. Movie2GIF 변환·GIF 이어붙이기 공통. */
export const GIF_HOLD_DEFAULT_SECONDS = 2;
export const GIF_HOLD_MIN_SECONDS = 0.1;
export const GIF_HOLD_MAX_SECONDS = 60;

/**
 * 입력값을 허용 범위의 초 값으로 맞춥니다. 숫자가 아니면 기본값을 돌려줍니다.
 *
 * @param {unknown} value
 */
export function normalizeHoldSeconds(value) {
  const n = Number(value);
  if (value === '' || value === null || value === undefined || !Number.isFinite(n)) return GIF_HOLD_DEFAULT_SECONDS;
  return Math.round(Math.min(GIF_HOLD_MAX_SECONDS, Math.max(GIF_HOLD_MIN_SECONDS, n)) * 100) / 100;
}

/**
 * 첫 프레임과 마지막 프레임을 각각 `seconds` 초씩 늘리는 ffmpeg `tpad` 필터.
 *
 * @param {number} seconds
 */
export function gifHoldFilter(seconds) {
  return `tpad=start_mode=clone:start_duration=${seconds}:stop_mode=clone:stop_duration=${seconds}`;
}
