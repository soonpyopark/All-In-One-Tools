/**
 * QR 화면(렌더러)용 상수·헬퍼. zlib/fflate 없이 가볍게 둔다.
 */

export const MAX_QR_BYTES = 2953;
export const MAX_QR_HANGUL = Math.floor(MAX_QR_BYTES / 3);

/** 붙여넣기·입력으로 받을 최대 문자 수 (코드 유닛). */
export const QR_INPUT_SOFT_LIMIT = 20_000;

const URL_RE = /^(?:https?:\/\/|www\.)[^\s<>"']+$/i;

/**
 * 한 줄이 http(s) URL이면 정규화된 주소를 반환. 아니면 null.
 * @param {string} text
 * @returns {string | null}
 */
export function asHttpUrl(text) {
  const value = String(text ?? '').trim();
  if (!value || /[\r\n\t ]/.test(value)) return null;
  if (!URL_RE.test(value)) return null;
  if (value.toLowerCase().startsWith('www.')) return `https://${value}`;
  return value;
}

/**
 * 표시 영역에 맞는 정수 모듈 크기(px).
 * @param {number} availPx
 * @param {number} canvasModules
 */
export function integerQrSide(availPx, canvasModules) {
  const canvas = Math.max(1, Math.floor(canvasModules));
  if (availPx < canvas) return Math.max(32, availPx);
  return Math.floor(availPx / canvas) * canvas;
}

/**
 * 표시용 글자 수. 큰 문자열에 스프레드(`[...s]`)를 쓰지 않는다.
 * @param {string} value
 */
export function displayCharCount(value) {
  return String(value ?? '').length;
}

/**
 * @param {string} value
 * @returns {{ text: string, truncated: boolean }}
 */
export function clampQrInput(value) {
  const text = String(value ?? '');
  if (text.length <= QR_INPUT_SOFT_LIMIT) return { text, truncated: false };
  return { text: text.slice(0, QR_INPUT_SOFT_LIMIT), truncated: true };
}
