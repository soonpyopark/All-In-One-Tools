/**
 * 헤더 범위: 시작 칸(A1) · 끝 칸(D1) 두 값으로 표시·해석합니다.
 * `A1~Z2`, `1A~2Z` 처럼 이어 쓴 문자열도 파싱할 수 있습니다.
 */

/**
 * @param {number} index 1-based
 */
export function columnLetter(index) {
  let n = Math.max(1, Math.floor(Number(index) || 1));
  let letters = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

/**
 * @param {string} letters
 * @returns {number} 1-based, 실패 시 0
 */
export function columnIndex(letters) {
  const text = String(letters ?? '').toUpperCase();
  if (!/^[A-Z]+$/.test(text)) return 0;
  let n = 0;
  for (const ch of text) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

/**
 * @param {number} row
 * @param {number} col 1-based
 */
export function formatCellRef(row, col) {
  const r = Math.max(1, Number(row) || 1);
  const c = Math.max(1, Number(col) || 1);
  return `${columnLetter(c)}${r}`;
}

/**
 * @param {string} token
 * @returns {{ row: number, col: number } | null}
 */
export function parseCellRef(token) {
  const text = String(token ?? '')
    .trim()
    .replace(/칸/gi, '')
    .replace(/\s+/g, '');
  const rowFirst = /^(\d+)([A-Za-z]+)$/.exec(text);
  if (rowFirst) {
    const col = columnIndex(rowFirst[2]);
    const row = Number(rowFirst[1]);
    if (!col || row < 1) return null;
    return { row, col };
  }
  const colFirst = /^([A-Za-z]+)(\d+)$/.exec(text);
  if (colFirst) {
    const col = columnIndex(colFirst[1]);
    const row = Number(colFirst[2]);
    if (!col || row < 1) return null;
    return { row, col };
  }
  return null;
}

/**
 * @param {{ start: number, end: number, colStart: number, colEnd: number }} range
 */
export function formatHeaderCells(range) {
  const start = Math.max(1, Number(range?.start) || 1);
  const end = Math.max(start, Number(range?.end) || start);
  const colStart = Math.max(1, Number(range?.colStart) || 1);
  const colEnd = Math.max(colStart, Number(range?.colEnd) || colStart);
  return {
    from: formatCellRef(start, colStart),
    to: formatCellRef(end, colEnd),
  };
}

/**
 * 로그·짧은 표시용 (`A1~D1`).
 * @param {{ start: number, end: number, colStart: number, colEnd: number }} range
 */
export function formatHeaderSpan(range) {
  const cells = formatHeaderCells(range);
  return `${cells.from}~${cells.to}`;
}

/**
 * @param {string} fromText
 * @param {string} toText
 * @returns {{ start: number, end: number, colStart: number, colEnd: number } | null}
 */
export function parseHeaderCells(fromText, toText) {
  const from = parseCellRef(fromText);
  const to = parseCellRef(toText);
  if (!from || !to) return null;
  const start = Math.min(from.row, to.row);
  const end = Math.max(from.row, to.row);
  const colStart = Math.min(from.col, to.col);
  const colEnd = Math.max(from.col, to.col);
  if (end - start > 19) return null;
  return { start, end, colStart, colEnd };
}

/**
 * @param {string} text `A1~D1` 또는 `A1 칸 ~ D1 칸` 등
 * @returns {{ start: number, end: number, colStart: number, colEnd: number } | null}
 */
export function parseHeaderSpan(text) {
  const raw = String(text ?? '')
    .trim()
    .replace(/칸/gi, '')
    .replace(/\s+/g, '');
  const parts = raw.split(/[~:]/);
  if (parts.length !== 2) return null;
  return parseHeaderCells(parts[0], parts[1]);
}

/**
 * 조인 키 열 범위: 시작 칸=헤더, 끝 칸=데이터 마지막 행. 같은 열만 허용.
 * @param {string} fromText
 * @param {string} toText
 * @returns {{ keyCol: number, headerRow: number, dataEnd: number } | null}
 */
export function parseKeyColumnRange(fromText, toText) {
  const from = parseCellRef(fromText);
  const to = parseCellRef(toText);
  if (!from || !to) return null;
  if (from.col !== to.col) return null;
  if (to.row <= from.row) return null;
  return { keyCol: from.col, headerRow: from.row, dataEnd: to.row };
}

/**
 * @param {{ keyCol: number, headerRow: number, dataEnd: number }} range
 */
export function formatKeyColumnCells(range) {
  const keyCol = Math.max(1, Number(range?.keyCol) || 1);
  const headerRow = Math.max(1, Number(range?.headerRow) || 1);
  const dataEnd = Math.max(headerRow + 1, Number(range?.dataEnd) || headerRow + 1);
  return {
    from: formatCellRef(headerRow, keyCol),
    to: formatCellRef(dataEnd, keyCol),
  };
}
