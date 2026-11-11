import { splitName } from '../../../shared/renameRules.js';

/**
 * 파일명 일괄 변경의 이름 변환 함수 모음. 모두 순수 함수이며
 * 이름(base)과 확장자(ext, 점 포함)를 나눠 받아 같은 모양으로 돌려줍니다.
 *
 * @typedef {{ base: string, ext: string }} Parts
 */

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 문자열 입력을 범위가 있는 정수로 바꿉니다. 비었거나 숫자가 아니면 기본값. */
export function toInt(value, min, max, fallback) {
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n) || String(value).trim() === '') return fallback;
  return Math.min(max, Math.max(min, n));
}

/** 정규식 모드에서 패턴이 잘못되었으면 이유를, 아니면 빈 문자열을 돌려줍니다. */
export function regexProblem(pattern, useRegex) {
  if (!useRegex || !pattern) return '';
  try {
    new RegExp(pattern);
    return '';
  } catch (err) {
    return `정규식이 올바르지 않습니다. (${err instanceof Error ? err.message : String(err)})`;
  }
}

/* ---------------------------------- 이름 ---------------------------------- */

/** 문자열 바꾸기. 정규식·대소문자 구분·확장자 포함 옵션. @returns {Parts} */
export function replaceText({ base, ext }, { find, replace, caseSensitive, regex, includeExt }) {
  if (!find) return { base, ext };
  const re = new RegExp(regex ? find : escapeRegExp(find), caseSensitive ? 'g' : 'gi');
  // 일반 모드의 바꿀 문자열은 그대로(글자 그대로) 넣고, 정규식 모드만 $1 같은 치환을 허용합니다.
  const sub = (text) => (regex ? text.replace(re, replace) : text.replace(re, () => replace));
  if (includeExt) return splitName(sub(base + ext));
  return { base: sub(base), ext };
}

/** 이름 앞에 추가. @returns {Parts} */
export function addPrefix({ base, ext }, text) {
  return { base: text + base, ext };
}

/** 이름 뒤(확장자 앞)에 추가. @returns {Parts} */
export function addSuffix({ base, ext }, text) {
  return { base: base + text, ext };
}

/** 이름 지우기(확장자는 유지). @returns {Parts} */
export function clearName({ ext }) {
  return { base: '', ext };
}

/**
 * 위치 지우기: `from` 번째 글자부터 `count` 글자를 지웁니다. `fromEnd` 면 뒤에서부터 셉니다.
 * @returns {Parts}
 */
export function deleteAt({ base, ext }, { from, count, fromEnd }) {
  const chars = Array.from(base);
  if (fromEnd) {
    const end = Math.max(0, chars.length - (from - 1));
    const start = Math.max(0, end - count);
    return { base: [...chars.slice(0, start), ...chars.slice(end)].join(''), ext };
  }
  const start = from - 1;
  return { base: [...chars.slice(0, start), ...chars.slice(start + count)].join(''), ext };
}

export const BRACKET_KINDS = [
  { id: 'round', label: '( )', open: '(', close: ')' },
  { id: 'square', label: '[ ]', open: '[', close: ']' },
  { id: 'curly', label: '{ }', open: '{', close: '}' },
  { id: 'angle', label: '< >', open: '<', close: '>' },
  { id: 'cjk-corner', label: '「 」', open: '「', close: '」' },
  { id: 'cjk-double', label: '『 』', open: '『', close: '』' },
  { id: 'cjk-lens', label: '【 】', open: '【', close: '】' },
  { id: 'full-round', label: '（ ）', open: '（', close: '）' },
];

/** 한 종류의 묶음 기호를 모두 처리합니다. 안쪽부터 반복해서 겹친 괄호도 지웁니다. */
function stripPairs(text, open, close, keepInner) {
  const o = escapeRegExp(open);
  const c = escapeRegExp(close);
  // 한 글자짜리 기호는 중첩을 처리하기 위해 가장 안쪽부터, 여러 글자면 가장 가까운 짝끼리 처리합니다.
  const single = Array.from(open).length === 1 && Array.from(close).length === 1;
  const re = single ? new RegExp(`${o}([^${o}${c}]*)${c}`, 'g') : new RegExp(`${o}([\\s\\S]*?)${c}`, 'g');
  let current = text;
  for (let i = 0; i < 30; i += 1) {
    const next = current.replace(re, keepInner ? '$1' : '');
    if (next === current) break;
    current = next;
  }
  return current;
}

/**
 * 묶인곳 지우기: 선택한 괄호와 그 안의 글자를 지웁니다. `keepInner` 면 괄호 기호만 지웁니다.
 * @returns {Parts}
 */
export function deleteBrackets({ base, ext }, { pairs, keepInner, cleanSpaces }) {
  let next = base;
  for (const [open, close] of pairs) {
    if (open && close) next = stripPairs(next, open, close, keepInner);
  }
  if (cleanSpaces && next !== base) next = next.replace(/\s{2,}/g, ' ').trim();
  return { base: next, ext };
}

/* ---------------------------------- 숫자 ---------------------------------- */

/** 숫자만 남기기 / 숫자 지우기. @returns {Parts} */
export function digitsOnly({ base, ext }, mode) {
  return { base: mode === 'keep' ? base.replace(/\D/g, '') : base.replace(/\d/g, ''), ext };
}

/**
 * 자리수 맞추기: 숫자 덩어리를 `width` 자리가 되도록 앞에 0 을 채웁니다.
 * `which` 는 'all' | 'first' | 'last', `trim` 이면 자리수를 넘는 앞쪽 0 은 줄입니다.
 * @returns {Parts}
 */
export function padDigits({ base, ext }, { width, which, trim }) {
  const runs = [...base.matchAll(/\d+/g)];
  if (runs.length === 0) return { base, ext };
  const pick = which === 'first' ? [runs[0]] : which === 'last' ? [runs[runs.length - 1]] : runs;
  let result = '';
  let cursor = 0;
  for (const match of pick) {
    const digits = match[0];
    const significant = digits.replace(/^0+/, '') || '0';
    const padded = trim
      ? significant.padStart(width, '0')
      : digits.length >= width
        ? digits
        : digits.padStart(width, '0');
    result += base.slice(cursor, match.index) + padded;
    cursor = match.index + digits.length;
  }
  return { base: result + base.slice(cursor), ext };
}

/**
 * 번호 붙이기. `index` 는 대상 목록에서의 순서(0부터, `perFolder` 면 폴더별 순서).
 * @returns {Parts}
 */
export function addNumber({ base, ext }, index, { start, step, width, position, at, sep, replaceName }) {
  const number = String(start + step * index).padStart(width, '0');
  const body = replaceName ? '' : base;
  if (position === 'suffix') return { base: body ? body + sep + number : number, ext };
  if (position === 'at') {
    const chars = Array.from(body);
    const cut = Math.min(chars.length, Math.max(0, at - 1));
    return { base: chars.slice(0, cut).join('') + number + chars.slice(cut).join(''), ext };
  }
  return { base: body ? number + sep + body : number, ext };
}

/* -------------------------------- 확장자 -------------------------------- */

/** 확장자 입력("jpg", ".jpg")을 점 없는 문자열로 정리합니다. */
const cleanExt = (text) => String(text ?? '').trim().replace(/^\.+/, '');

/** 확장자 삭제. @returns {Parts} */
export function removeExt({ base }) {
  return { base, ext: '' };
}

/** 확장자 추가. `onlyIfNone` 이면 이미 확장자가 있는 파일은 건너뜁니다. @returns {Parts} */
export function addExt({ base, ext }, { text, onlyIfNone }) {
  const added = cleanExt(text);
  if (!added || (onlyIfNone && ext)) return { base, ext };
  return { base, ext: `${ext}.${added}` };
}

/**
 * 확장자 변경. `only`(쉼표·공백으로 구분)가 있으면 그 확장자만 바꿉니다.
 * `caseMode` 는 'keep' | 'lower' | 'upper'. 새 확장자가 비어 있으면 대소문자만 바꿉니다.
 * 확장자가 없는 파일은 건너뜁니다.
 * @returns {Parts}
 */
export function changeExt({ base, ext }, { text, only, caseMode }) {
  if (!ext) return { base, ext };
  const current = ext.slice(1);
  const filter = String(only ?? '')
    .split(/[\s,;]+/)
    .map((item) => cleanExt(item).toLowerCase())
    .filter(Boolean);
  if (filter.length > 0 && !filter.includes(current.toLowerCase())) return { base, ext };
  let next = cleanExt(text) || current;
  if (caseMode === 'lower') next = next.toLowerCase();
  if (caseMode === 'upper') next = next.toUpperCase();
  return { base, ext: next ? `.${next}` : '' };
}

/* -------------------------------- 정렬 -------------------------------- */

export const SORT_KEYS = [
  { id: 'name', label: '현재 이름' },
  { id: 'newName', label: '바뀔 이름' },
  { id: 'dir', label: '파일 위치' },
  { id: 'mtime', label: '수정 날짜' },
  { id: 'size', label: '크기' },
  { id: 'ext', label: '확장자' },
];
