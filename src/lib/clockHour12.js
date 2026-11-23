/** 사이드바·시계 페이지가 시제 설정을 맞추기 위한 이벤트. */
export const CLOCK_HOUR12_EVENT = 'alltools:clockHour12';

/**
 * @param {boolean} clockHour12
 */
export function notifyClockHour12(clockHour12) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent(CLOCK_HOUR12_EVENT, { detail: { clockHour12: Boolean(clockHour12) } }),
  );
}
