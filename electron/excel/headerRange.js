/**
 * 시트 앞부분에서 헤더 행 범위(1-based, 포함)를 고릅니다.
 * 제목 행은 빼고, 병합으로 이어진 머리글 행은 한 범위로 묶습니다.
 */

/**
 * @param {unknown} value
 */
function cellText(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * @param {unknown[][]} rows
 * @param {number} index
 * @returns {string[]}
 */
function rowParts(rows, index) {
  const row = rows[index];
  return (Array.isArray(row) ? row : []).map((cell) => cellText(cell));
}

/**
 * @param {string[]} parts
 */
function filled(parts) {
  return parts.filter((part) => part.length > 0);
}

/**
 * @param {string} value
 */
function isNumber(value) {
  return /^-?\d+(\.\d+)?$/.test(value);
}

/**
 * @param {Array<{ s?: { r?: number, c?: number }, e?: { r?: number, c?: number } }>} merges
 * @param {number} rowIndex 0-based
 */
function horizontalSpan(merges, rowIndex) {
  let widest = 1;
  for (const range of merges) {
    if (!range?.s || !range?.e) continue;
    if (range.s.r !== rowIndex || range.e.r !== rowIndex) continue;
    widest = Math.max(widest, range.e.c - range.s.c + 1);
  }
  return widest;
}

/**
 * 병합 칸의 값을 범위 전체에 채웁니다.
 * @param {unknown[][]} rows
 * @param {Array<{ s?: { r?: number, c?: number }, e?: { r?: number, c?: number } }>} merges
 * @returns {unknown[][]}
 */
export function fillMergedCells(rows, merges) {
  if (!Array.isArray(merges) || merges.length === 0) return rows;
  /** @type {unknown[][]} */
  const out = rows.map((row) => (Array.isArray(row) ? [...row] : []));
  for (const range of merges) {
    if (!range?.s || !range?.e) continue;
    const sr = Number(range.s.r) || 0;
    const sc = Number(range.s.c) || 0;
    const er = Number(range.e.r) || sr;
    const ec = Number(range.e.c) || sc;
    while (out.length <= sr) out.push([]);
    while (out[sr].length <= sc) out[sr].push('');
    const value = out[sr][sc] ?? '';
    for (let r = sr; r <= er; r += 1) {
      for (let c = sc; c <= ec; c += 1) {
        while (out.length <= r) out.push([]);
        while (out[r].length <= c) out[r].push('');
        if (out[r][c] === '' || out[r][c] == null) out[r][c] = value;
      }
    }
  }
  return out;
}

/**
 * @param {unknown[][]} rows 병합 값이 채워진 행
 * @param {{
 *   merges?: Array<{ s?: { r?: number, c?: number }, e?: { r?: number, c?: number } }>,
 *   rawRows?: unknown[][],
 *   maxScan?: number,
 * }} [options]
 * @returns {{ start: number, end: number }}
 */
export function detectHeaderRange(rows, options = {}) {
  const filledRows = Array.isArray(rows) ? rows : [];
  const rawRows = Array.isArray(options.rawRows) ? options.rawRows : filledRows;
  const merges = Array.isArray(options.merges) ? options.merges : [];
  if (filledRows.length === 0) return { start: 1, end: 1 };

  // 머리글은 시트 위에 있다. 아래쪽의 넓은 글자 구간을 헤더로 고르지 않는다.
  const limit = Math.min(filledRows.length, Math.max(1, Number(options.maxScan) || 8));
  let usedWidth = 1;
  for (let i = 0; i < limit; i += 1) {
    usedWidth = Math.max(usedWidth, rowParts(rawRows, i).length, rowParts(filledRows, i).length);
  }
  for (const range of merges) {
    if ((range?.s?.r ?? 0) < limit) usedWidth = Math.max(usedWidth, (range?.e?.c ?? 0) + 1);
  }

  /**
   * @param {number} index
   */
  const titleAt = (index) => {
    const rawValues = filled(rowParts(rawRows, index));
    if (!rawValues.length) return false;
    const span = horizontalSpan(merges, index);
    const titleWidth = Math.max(3, Math.ceil(usedWidth * 0.6));
    if (rawValues.length <= 2 && span >= titleWidth) return true;
    if (rawValues.length === 1 && span >= 3) return true;
    return false;
  };

  /**
   * @param {number} index
   */
  const valuesAt = (index) => filled(rowParts(filledRows, index));

  /**
   * @param {number} index
   */
  const dataAt = (index) => {
    const values = valuesAt(index);
    if (values.length < 2) return false;
    const numeric = values.filter((value) => isNumber(value)).length;
    return numeric / values.length >= 0.3;
  };

  /**
   * @param {number} index
   */
  const headerAt = (index) => {
    if (titleAt(index) || dataAt(index)) return false;
    const values = valuesAt(index);
    if (values.length < 2) return false;
    const numeric = values.filter((value) => isNumber(value)).length;
    if (numeric / values.length >= 0.3) return false;
    const avg = values.reduce((sum, value) => sum + value.length, 0) / values.length;
    return avg <= 24;
  };

  let start = -1;
  for (let i = 0; i < limit; i += 1) {
    if (headerAt(i)) {
      start = i;
      break;
    }
  }
  if (start < 0) return { start: 1, end: 1, colStart: 1, colEnd: 1 };

  let end = start;
  const maxEnd = Math.min(filledRows.length - 1, start + 2);
  for (let i = start + 1; i <= maxEnd; i += 1) {
    if (!headerAt(i)) break;
    let seenData = false;
    for (let j = i + 1; j <= Math.min(filledRows.length - 1, i + 2); j += 1) {
      if (dataAt(j)) {
        seenData = true;
        break;
      }
      if (valuesAt(j).length > 0 && !headerAt(j)) break;
    }
    const linked = merges.some((range) => {
      if (!range?.s || !range?.e || range.e.r <= range.s.r) return false;
      return range.s.r <= end && range.e.r >= i;
    });
    if (!seenData && !linked) break;
    end = i;
  }

  const rowStart = start + 1;
  const rowEnd = end + 1;
  let colMin = Infinity;
  let colMax = -1;
  for (let r = start; r <= end; r += 1) {
    const parts = rowParts(filledRows, r);
    parts.forEach((value, index) => {
      if (!value) return;
      colMin = Math.min(colMin, index);
      colMax = Math.max(colMax, index);
    });
  }
  for (const range of merges) {
    if (!range?.s || !range?.e) continue;
    if (range.e.r < start || range.s.r > end) continue;
    colMin = Math.min(colMin, range.s.c || 0);
    colMax = Math.max(colMax, range.e.c || 0);
  }
  if (!Number.isFinite(colMin) || colMax < colMin) {
    colMin = 0;
    colMax = 0;
  }
  return { start: rowStart, end: rowEnd, colStart: colMin + 1, colEnd: colMax + 1 };
}

/**
 * @param {unknown} startRaw
 * @param {unknown} endRaw
 * @returns {{ start: number, end: number }}
 */
export function normalizeHeaderRange(startRaw, endRaw) {
  let start = Math.floor(Number(startRaw) || 1);
  let end = Math.floor(Number(endRaw) || start);
  if (!Number.isFinite(start) || start < 1) start = 1;
  if (!Number.isFinite(end) || end < 1) end = start;
  if (start > 200) start = 200;
  if (end < start) end = start;
  if (end - start > 19) end = start + 19;
  return { start, end };
}

/**
 * 헤더 범위를 `상위|하위` 한 줄 라벨로 펼칩니다.
 * @param {unknown[][]} rows
 * @param {number} start 1-based
 * @param {number} end 1-based
 * @returns {string[]}
 */
export function flattenHeaderLabels(rows, start, end) {
  const range = normalizeHeaderRange(start, end);
  const block = [];
  const last = Math.min(range.end, rows.length);
  const first = Math.min(range.start, Math.max(last, 1));
  for (let i = first - 1; i < last; i += 1) block.push(rows[i] || []);
  if (!block.length) return [];

  let width = 0;
  for (const row of block) width = Math.max(width, Array.isArray(row) ? row.length : 0);
  /** @type {string[][]} */
  const grid = block.map((row) => {
    const list = Array.isArray(row) ? row : [];
    /** @type {string[]} */
    const next = [];
    for (let c = 0; c < width; c += 1) next.push(cellText(list[c]));
    return next;
  });
  for (let c = 0; c < width; c += 1) {
    let carry = '';
    for (let r = 0; r < grid.length; r += 1) {
      if (grid[r][c]) carry = grid[r][c];
      else if (carry) grid[r][c] = carry;
    }
  }
  for (let r = 0; r < grid.length; r += 1) {
    let carry = '';
    for (let c = 0; c < width; c += 1) {
      if (grid[r][c]) carry = grid[r][c];
      else if (carry) grid[r][c] = carry;
    }
  }

  /** @type {string[]} */
  const labels = [];
  for (let c = 0; c < width; c += 1) {
    /** @type {string[]} */
    const parts = [];
    for (let r = 0; r < grid.length; r += 1) {
      const text = grid[r][c];
      if (!text) continue;
      const prev = parts[parts.length - 1];
      if (prev && prev.toLowerCase() === text.toLowerCase()) continue;
      parts.push(text);
    }
    labels.push(parts.join('|'));
  }
  return labels;
}
