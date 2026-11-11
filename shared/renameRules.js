/**
 * 파일명 일괄 변경 공용 규칙 (화면·메인 프로세스에서 같이 사용).
 */

/** Windows 에서 파일 이름에 쓸 수 없는 문자(제어 문자 포함). */
const INVALID_CHARS = /[\\/:*?"<>|\u0000-\u001f]/;
/** Windows 예약 이름 (확장자가 붙어도 안 됨). */
const RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/**
 * 전체 파일 이름(확장자 포함)에서 문제를 찾아 이유를 돌려줍니다. 문제가 없으면 빈 문자열.
 *
 * @param {string} name
 * @returns {string}
 */
export function invalidNameReason(name) {
  if (typeof name !== 'string' || name.length === 0) return '이름이 비어 있습니다.';
  if (name === '.' || name === '..') return '사용할 수 없는 이름입니다.';
  if (INVALID_CHARS.test(name)) return '\\ / : * ? " < > | 문자는 이름에 쓸 수 없습니다.';
  if (/[. ]$/.test(name)) return '이름 끝에 점이나 공백을 둘 수 없습니다.';
  if (RESERVED_NAMES.test(name)) return 'Windows 예약 이름은 쓸 수 없습니다.';
  if (name.length > 255) return '이름이 너무 깁니다. (255자 이하)';
  return '';
}

/**
 * 이름과 확장자(점 포함)를 나눕니다. `.gitignore` 처럼 점으로 시작하거나 점으로 끝나는 이름은
 * 확장자가 없는 것으로 봅니다.
 *
 * @param {string} name
 * @returns {{ base: string, ext: string }}
 */
export function splitName(name) {
  const index = name.lastIndexOf('.');
  if (index <= 0 || index === name.length - 1) return { base: name, ext: '' };
  return { base: name.slice(0, index), ext: name.slice(index) };
}
