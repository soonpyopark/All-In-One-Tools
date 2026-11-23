/**
 * 여러 Excel 파일을 하나의 .xlsx 로 병합합니다.
 * sheets / append / same_name / named / join / folder
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import ExcelJS from 'exceljs';
import { detectHeaderRange, normalizeHeaderRange } from '../excel/headerRange.js';
import {
  formatCellRef,
  parseKeyColumnRange,
} from '../../shared/headerSpan.js';

const require = createRequire(import.meta.url);
const XLSX = require('../excelCompare/xlsx.full.min.cjs');

export const MODE_SHEETS = 'sheets';
export const MODE_APPEND = 'append';
export const MODE_SAME_NAME = 'same_name';
export const MODE_NAMED = 'named';
export const MODE_JOIN = 'join';
export const MODE_FOLDER = 'folder';

export const SHEET_SCOPE_FIRST = 'first';
export const SHEET_SCOPE_ALL = 'all';

export const NAME_FILE = 'file';
export const NAME_SHEET = 'sheet';
export const NAME_FILE_SHEET = 'file_sheet';

export const NAMED_AS_SHEETS = 'sheets';
export const NAMED_AS_APPEND = 'append';

/** 이어 붙일 때 열을 헤더 이름으로 맞춤 (기본) */
export const COLUMN_ALIGN_HEADER = 'header';
/** 이어 붙일 때 열을 왼쪽부터 위치 기준으로 맞춤 */
export const COLUMN_ALIGN_POSITION = 'position';

const OPENXML = new Set(['.xlsx', '.xlsm', '.xltx', '.xltm']);
const LEGACY = new Set(['.xls', '.xlt', '.xlsb']);
export const EXCEL_EXTENSIONS = [...OPENXML, ...LEGACY];

const ALL_MODES = new Set([
  MODE_SHEETS,
  MODE_APPEND,
  MODE_SAME_NAME,
  MODE_NAMED,
  MODE_JOIN,
  MODE_FOLDER,
]);

/**
 * @param {string} filePath
 */
export function isExcelFile(filePath) {
  return EXCEL_EXTENSIONS.includes(path.extname(String(filePath || '')).toLowerCase());
}

/**
 * @param {string} name
 */
export function sanitizeMergeName(name) {
  let base = String(name ?? '').trim() || '병합';
  base = base.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim();
  return base || '병합';
}

/**
 * @param {string[]} paths
 * @param {string} outputDir
 * @param {string} outputName
 */
export function resolveOutputPath(paths, outputDir, outputName) {
  const first = String(paths[0] || '');
  const folder = String(outputDir || '').trim() || path.dirname(first);
  return path.join(folder, `${sanitizeMergeName(outputName)}.xlsx`);
}

/**
 * @param {string} raw
 * @param {Set<string>} used
 */
function uniqueSheetName(raw, used) {
  let base = String(raw ?? '')
    .replace(/[\\/*?:[\]]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  if (!base) base = 'Sheet';
  base = base.slice(0, 31);
  let name = base;
  let n = 2;
  while (used.has(name.toLowerCase())) {
    const suffix = `_${n}`;
    name = `${base.slice(0, Math.max(1, 31 - suffix.length))}${suffix}`;
    n += 1;
  }
  used.add(name.toLowerCase());
  return name;
}

/**
 * @param {string} filePath
 * @param {string} sheetName
 * @param {string} nameMode
 * @param {boolean} multiSheet
 * @param {string} [folderRoot]
 */
function makeSheetTitle(filePath, sheetName, nameMode, multiSheet, folderRoot) {
  const stem = path.parse(filePath).name || '파일';
  const sheet = String(sheetName || 'Sheet').trim() || 'Sheet';
  if (folderRoot) {
    const rel = path.relative(folderRoot, filePath);
    const relStem = path.join(path.dirname(rel), path.parse(rel).name).replace(/\\/g, '/');
    const label = relStem.replace(/^\.\//, '') || stem;
    if (multiSheet || nameMode === NAME_FILE_SHEET) return `${label}_${sheet}`;
    return label;
  }
  if (nameMode === NAME_SHEET) return sheet;
  if (nameMode === NAME_FILE_SHEET || multiSheet) return `${stem}_${sheet}`;
  return stem;
}

/**
 * @param {string[]} paths
 */
function commonParentDir(paths) {
  if (paths.length === 0) return '';
  const dirs = paths.map((p) => path.dirname(path.resolve(p)));
  let common = dirs[0].split(path.sep);
  for (let i = 1; i < dirs.length; i += 1) {
    const parts = dirs[i].split(path.sep);
    let j = 0;
    while (j < common.length && j < parts.length && common[j] === parts[j]) j += 1;
    common = common.slice(0, j);
  }
  if (common.length === 0) return path.parse(dirs[0]).root || dirs[0];
  return common.join(path.sep);
}

function readBook(filePath) {
  const buf = fs.readFileSync(filePath);
  return XLSX.read(buf, { type: 'buffer', cellDates: true, dense: false });
}

/**
 * 병합 칸 값을 범위 전체에 채웁니다. (시트JS는 좌상단만 값을 둡니다.)
 * @param {import('xlsx').WorkSheet} sheet
 * @param {unknown[][]} rows
 * @returns {unknown[][]}
 */
function fillMergedCells(sheet, rows) {
  const merges = sheet?.['!merges'];
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
        if (out[r][c] === '' || out[r][c] == null) {
          out[r][c] = value;
        }
      }
    }
  }
  return out;
}

/**
 * @param {import('xlsx').WorkBook} wb
 * @param {string} sheetName
 * @returns {unknown[][]}
 */
function sheetToRows(wb, sheetName) {
  const sheet = wb.Sheets[sheetName];
  if (!sheet) return [];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
  return fillMergedCells(sheet, Array.isArray(rows) ? rows : []);
}

/**
 * @param {unknown} value
 */
function cellText(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 헤더 블록 빈칸을 위·왼쪽 값으로 채웁니다. (병합 정보가 빠진 경우 보완)
 * @param {unknown[][]} block
 * @returns {unknown[][]}
 */
function fillHeaderBlock(block) {
  const height = block.length;
  if (height === 0) return [];
  let width = 0;
  for (const row of block) {
    width = Math.max(width, Array.isArray(row) ? row.length : 0);
  }
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
    for (let r = 0; r < height; r += 1) {
      if (grid[r][c]) carry = grid[r][c];
      else if (carry) grid[r][c] = carry;
    }
  }
  for (let r = 0; r < height; r += 1) {
    let carry = '';
    for (let c = 0; c < width; c += 1) {
      if (grid[r][c]) carry = grid[r][c];
      else if (carry) grid[r][c] = carry;
    }
  }
  return grid;
}

/**
 * 여러 헤더 행을 열마다 `상위|하위` 한 줄로 펼칩니다.
 * @param {unknown[][]} block
 * @returns {string[]}
 */
function flattenHeaderBlock(block) {
  const filled = fillHeaderBlock(block);
  if (!filled.length) return [];
  const width = filled[0]?.length || 0;
  /** @type {string[]} */
  const keys = [];
  for (let c = 0; c < width; c += 1) {
    /** @type {string[]} */
    const parts = [];
    for (let r = 0; r < filled.length; r += 1) {
      const text = cellText(filled[r][c]);
      if (!text) continue;
      const last = parts[parts.length - 1];
      if (last && last.toLowerCase() === text.toLowerCase()) continue;
      parts.push(text);
    }
    keys.push(parts.join('|'));
  }
  return keys;
}

/**
 * 헤더 범위를 한 줄로 펼치고, 그 앞의 제목 행은 뺀 뒤 본문을 이어 붙입니다.
 * @param {unknown[][]} rows
 * @param {{ start: number, end: number }} range
 * @returns {unknown[][]}
 */
function prepareAppendRows(rows, range) {
  if (!rows.length) return rows;
  const start = Math.max(1, Math.min(range.start, rows.length));
  const end = Math.max(start, Math.min(range.end, rows.length));
  if (start === 1 && end === 1) return rows;
  const flat = flattenHeaderBlock(rows.slice(start - 1, end));
  return [flat, ...rows.slice(end)];
}

/**
 * 첫 시트의 헤더 행 범위를 자동으로 고릅니다.
 * @param {string} filePath
 * @returns {{ start: number, end: number, sheetName: string }}
 */
export function detectHeaderFromFile(filePath) {
  const wb = readBook(filePath);
  const sheetName = Array.isArray(wb.SheetNames) ? wb.SheetNames[0] : '';
  if (!sheetName || !wb.Sheets?.[sheetName]) return { start: 1, end: 1, sheetName: '' };
  const sheet = wb.Sheets[sheetName];
  const raw = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
  const rawRows = Array.isArray(raw) ? raw : [];
  const merges = Array.isArray(sheet['!merges']) ? sheet['!merges'] : [];
  const filled = fillMergedCells(sheet, rawRows);
  const detected = detectHeaderRange(filled, { merges, rawRows });
  return { ...detected, sheetName };
}

/**
 * @param {unknown} raw
 */
export function normalizeHeaderRowCount(raw) {
  const n = Math.floor(Number(raw) || 1);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, 20);
}

/**
 * @param {string} text
 * @returns {string[]}
 */
export function parseSheetFilters(text) {
  return String(text ?? '')
    .split(/[\n,;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * @param {string[]} sheetNames
 * @param {string[]} filters
 * @returns {string[]}
 */
function matchSheetNames(sheetNames, filters) {
  if (!filters.length) return [];
  /** @type {string[]} */
  const out = [];
  const seen = new Set();
  for (const filter of filters) {
    const asIndex = Number(filter);
    if (Number.isInteger(asIndex) && asIndex >= 1 && asIndex <= sheetNames.length) {
      const name = sheetNames[asIndex - 1];
      const key = name.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        out.push(name);
      }
      continue;
    }
    const lower = filter.toLowerCase();
    const exact = sheetNames.find((name) => name.toLowerCase() === lower);
    if (exact) {
      const key = exact.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        out.push(exact);
      }
      continue;
    }
    // 부분 일치
    for (const name of sheetNames) {
      if (!name.toLowerCase().includes(lower)) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(name);
    }
  }
  return out;
}

/**
 * @param {import('exceljs').Worksheet} target
 * @param {unknown[][]} rows
 * @param {number} startRow 1-based
 * @param {{ sourceLabel?: string, colOffset?: number }} [opts]
 * @returns {number} next row
 */
function writeRows(target, rows, startRow, opts = {}) {
  let rowNum = startRow;
  const colOffset = Number(opts.colOffset) || 0;
  for (const row of rows) {
    const list = Array.isArray(row) ? row : [];
    const excelRow = target.getRow(rowNum);
    let col = 1 + colOffset;
    if (opts.sourceLabel != null) {
      excelRow.getCell(col).value = opts.sourceLabel;
      col += 1;
    }
    for (let i = 0; i < list.length; i += 1) {
      const value = list[i];
      excelRow.getCell(col + i).value = value === '' ? null : value;
    }
    excelRow.commit();
    rowNum += 1;
  }
  return rowNum;
}

/**
 * 시트 안 중복 헤더를 이름, 이름_2 형태로 구분합니다.
 * @param {unknown[]} headerRow
 * @returns {string[]}
 */
function normalizeHeaderKeys(headerRow) {
  const list = Array.isArray(headerRow) ? headerRow : [];
  /** @type {string[]} */
  const keys = [];
  const used = new Map();
  const width = list.length;
  for (let i = 0; i < width; i += 1) {
    let base = String(list[i] ?? '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!base) base = `__빈열${i + 1}`;
    const lower = base.toLowerCase();
    const count = (used.get(lower) || 0) + 1;
    used.set(lower, count);
    keys.push(count === 1 ? base : `${base}_${count}`);
  }
  return keys;
}

/**
 * @param {Array<{ rows: unknown[][] }>} chunks
 * @returns {string[]}
 */
function collectHeaderUnion(chunks) {
  /** @type {string[]} */
  const order = [];
  const seen = new Set();
  for (const chunk of chunks) {
    const rows = chunk.rows;
    if (!rows.length) continue;
    for (const key of normalizeHeaderKeys(rows[0] || [])) {
      const lower = key.toLowerCase();
      if (seen.has(lower)) continue;
      seen.add(lower);
      order.push(key);
    }
  }
  return order;
}

/**
 * @param {unknown[]} row
 * @param {string[]} sourceKeys
 * @param {string[]} targetKeys
 * @returns {unknown[]}
 */
function remapRowByHeaders(row, sourceKeys, targetKeys) {
  /** @type {Map<string, number>} */
  const indexByKey = new Map();
  for (let i = 0; i < sourceKeys.length; i += 1) {
    indexByKey.set(sourceKeys[i].toLowerCase(), i);
  }
  const list = Array.isArray(row) ? row : [];
  return targetKeys.map((key) => {
    const idx = indexByKey.get(key.toLowerCase());
    if (idx == null) return '';
    return list[idx] ?? '';
  });
}

/**
 * @param {import('exceljs').Worksheet} target
 * @param {Array<{ rows: unknown[][], sourceLabel?: string }>} chunks
 * @param {{
 *   keepFirstHeader: boolean,
 *   addSourceColumn: boolean,
 *   columnAlign?: string,
 * }} opts
 */
function appendChunks(target, chunks, opts) {
  const alignHeader = opts.columnAlign !== COLUMN_ALIGN_POSITION;
  const usable = chunks.filter((chunk) => Array.isArray(chunk.rows) && chunk.rows.length > 0);

  if (!alignHeader) {
    let nextRow = 1;
    let wroteHeader = false;
    for (const chunk of usable) {
      const rows = chunk.rows;
      let body = rows;
      if (opts.keepFirstHeader) {
        if (!wroteHeader) {
          const header = rows[0] || [];
          const headerOut = opts.addSourceColumn ? ['출처', ...header] : header;
          nextRow = writeRows(target, [headerOut], nextRow);
          wroteHeader = true;
          body = rows.slice(1);
        } else {
          body = rows.slice(1);
        }
      }
      nextRow = writeRows(
        target,
        body,
        nextRow,
        opts.addSourceColumn && chunk.sourceLabel ? { sourceLabel: chunk.sourceLabel } : {},
      );
    }
    return nextRow;
  }

  const columnOrder = collectHeaderUnion(usable);
  let nextRow = 1;
  if (opts.keepFirstHeader && columnOrder.length > 0) {
    const headerOut = opts.addSourceColumn ? ['출처', ...columnOrder] : columnOrder;
    nextRow = writeRows(target, [headerOut], nextRow);
  }

  for (const chunk of usable) {
    const rows = chunk.rows;
    const sourceKeys = normalizeHeaderKeys(rows[0] || []);
    // 헤더 유지 시 본문만, 아니면 첫 행도 데이터로 쓰되 열 맞춤 키는 첫 행을 사용합니다.
    const dataRows = opts.keepFirstHeader ? rows.slice(1) : rows;
    const remapped = dataRows.map((row) => remapRowByHeaders(row, sourceKeys, columnOrder));
    nextRow = writeRows(
      target,
      remapped,
      nextRow,
      opts.addSourceColumn && chunk.sourceLabel ? { sourceLabel: chunk.sourceLabel } : {},
    );
  }
  return nextRow;
}

/**
 * @param {string[]} paths
 * @param {{
 *   sheetScope: string,
 *   sheetNameMode: string,
 *   folderRoot?: string,
 *   sheetFilter?: string[],
 *   onProgress?: Function,
 * }} cfg
 * @param {import('exceljs').Workbook} outWb
 * @param {Set<string>} usedNames
 */
function mergeAsSheets(paths, cfg, outWb, usedNames) {
  const total = paths.length;
  for (let i = 0; i < paths.length; i += 1) {
    const filePath = paths[i];
    const base = path.basename(filePath);
    cfg.onProgress?.({ index: i + 1, total, name: base });
    const wb = readBook(filePath);
    const names = Array.isArray(wb.SheetNames) ? wb.SheetNames : [];
    if (!names.length) continue;
    let selected =
      cfg.sheetScope === SHEET_SCOPE_ALL ? names : [names[0]];
    if (cfg.sheetFilter?.length) {
      selected = matchSheetNames(names, cfg.sheetFilter);
    }
    const multi = selected.length > 1;
    for (const sheetName of selected) {
      const rows = sheetToRows(wb, sheetName);
      const title = uniqueSheetName(
        makeSheetTitle(
          filePath,
          sheetName,
          cfg.sheetNameMode,
          multi || cfg.sheetScope === SHEET_SCOPE_ALL,
          cfg.folderRoot,
        ),
        usedNames,
      );
      const target = outWb.addWorksheet(title);
      writeRows(target, rows, 1);
    }
  }
}

/**
 * @param {string[]} paths
 * @param {{
 *   sheetScope: string,
 *   keepFirstHeader: boolean,
 *   addSourceColumn: boolean,
 *   columnAlign?: string,
 *   headerRange?: { start: number, end: number },
 *   sheetFilter?: string[],
 *   onProgress?: Function,
 * }} cfg
 * @param {import('exceljs').Workbook} outWb
 * @param {Set<string>} usedNames
 */
function mergeAppend(paths, cfg, outWb, usedNames) {
  const target = outWb.addWorksheet(uniqueSheetName('병합', usedNames));
  const headerRange = normalizeHeaderRange(cfg.headerRange?.start, cfg.headerRange?.end);
  /** @type {Array<{ rows: unknown[][], sourceLabel?: string }>} */
  const chunks = [];
  const total = paths.length;
  for (let i = 0; i < paths.length; i += 1) {
    const filePath = paths[i];
    const base = path.basename(filePath);
    cfg.onProgress?.({ index: i + 1, total, name: base });
    const wb = readBook(filePath);
    const names = Array.isArray(wb.SheetNames) ? wb.SheetNames : [];
    if (!names.length) continue;
    let selected = cfg.sheetScope === SHEET_SCOPE_ALL ? names : [names[0]];
    if (cfg.sheetFilter?.length) {
      selected = matchSheetNames(names, cfg.sheetFilter);
    }
    for (const sheetName of selected) {
      const rows = prepareAppendRows(sheetToRows(wb, sheetName), headerRange);
      if (!rows.length) continue;
      chunks.push({
        rows,
        sourceLabel:
          cfg.sheetScope === SHEET_SCOPE_ALL || (cfg.sheetFilter?.length ?? 0) > 0
            ? `${base} / ${sheetName}`
            : base,
      });
    }
  }
  appendChunks(target, chunks, {
    keepFirstHeader: cfg.keepFirstHeader,
    addSourceColumn: cfg.addSourceColumn,
    columnAlign: cfg.columnAlign,
  });
}

/**
 * 같은 시트 이름끼리 아래로 이어 붙입니다.
 * @param {string[]} paths
 * @param {{
 *   keepFirstHeader: boolean,
 *   addSourceColumn: boolean,
 *   columnAlign?: string,
 *   headerRange?: { start: number, end: number },
 *   onProgress?: Function,
 * }} cfg
 * @param {import('exceljs').Workbook} outWb
 * @param {Set<string>} usedNames
 */
function mergeSameName(paths, cfg, outWb, usedNames) {
  const headerRange = normalizeHeaderRange(cfg.headerRange?.start, cfg.headerRange?.end);
  /** @type {Map<string, { title: string, chunks: Array<{ rows: unknown[][], sourceLabel?: string }> }>} */
  const groups = new Map();
  const total = paths.length;
  for (let i = 0; i < paths.length; i += 1) {
    const filePath = paths[i];
    const base = path.basename(filePath);
    cfg.onProgress?.({ index: i + 1, total, name: base });
    const wb = readBook(filePath);
    const names = Array.isArray(wb.SheetNames) ? wb.SheetNames : [];
    for (const sheetName of names) {
      const key = sheetName.toLowerCase();
      let group = groups.get(key);
      if (!group) {
        group = { title: sheetName, chunks: [] };
        groups.set(key, group);
      }
      const rows = prepareAppendRows(sheetToRows(wb, sheetName), headerRange);
      if (!rows.length) continue;
      group.chunks.push({ rows, sourceLabel: base });
    }
  }
  for (const group of groups.values()) {
    if (!group.chunks.length) continue;
    const target = outWb.addWorksheet(uniqueSheetName(group.title, usedNames));
    appendChunks(target, group.chunks, {
      keepFirstHeader: cfg.keepFirstHeader,
      addSourceColumn: cfg.addSourceColumn,
      columnAlign: cfg.columnAlign,
    });
  }
}

/**
 * 키 열 범위를 정규화합니다. 시작 칸=헤더, 끝 칸=데이터 마지막(같은 열).
 * @param {unknown} keyFrom
 * @param {unknown} keyTo
 * @param {unknown} [legacyKeyColumn] 예전 키 열 번호(1-based) 호환
 * @returns {{ keyCol: number, headerRow: number, dataEnd: number }}
 */
export function normalizeKeyColumnRange(keyFrom, keyTo, legacyKeyColumn) {
  const parsed = parseKeyColumnRange(String(keyFrom ?? ''), String(keyTo ?? ''));
  if (parsed) return parsed;
  const keyCol = Math.max(1, Math.floor(Number(legacyKeyColumn) || 1));
  return { keyCol, headerRow: 1, dataEnd: 2 };
}

/**
 * 첫 시트 A열(또는 첫 데이터 열) 기준으로 키 범위 A1~A{마지막} 을 제안합니다.
 * @param {string} filePath
 * @returns {{ keyCol: number, headerRow: number, dataEnd: number, from: string, to: string, sheetName: string }}
 */
export function detectKeyRangeFromFile(filePath) {
  const wb = readBook(filePath);
  const sheetName = Array.isArray(wb.SheetNames) ? wb.SheetNames[0] : '';
  if (!sheetName) {
    return { keyCol: 1, headerRow: 1, dataEnd: 2, from: 'A1', to: 'A2', sheetName: '' };
  }
  const rows = sheetToRows(wb, sheetName);
  let lastRow = 0;
  for (let r = 0; r < rows.length; r += 1) {
    const row = Array.isArray(rows[r]) ? rows[r] : [];
    const hasValue = row.some((cell) => String(cell ?? '').trim() !== '');
    if (hasValue) lastRow = r + 1;
  }
  const headerRow = 1;
  const dataEnd = Math.max(headerRow + 1, lastRow || 2);
  const keyCol = 1;
  return {
    keyCol,
    headerRow,
    dataEnd,
    from: formatCellRef(headerRow, keyCol),
    to: formatCellRef(dataEnd, keyCol),
    sheetName,
  };
}

/**
 * 키 열 기준 가로 결합 (첫 파일 기준 왼쪽 조인 + 나머지 키는 아래 추가).
 * 시작 칸=헤더 행, 그 다음~끝 행=데이터. 같은 열이 키.
 * @param {string[]} paths
 * @param {{ keyCol: number, headerRow: number, dataEnd: number, onProgress?: Function }} cfg
 * @param {import('exceljs').Workbook} outWb
 * @param {Set<string>} usedNames
 */
function mergeJoin(paths, cfg, outWb, usedNames) {
  const keyCol = Math.max(1, Number(cfg.keyCol) || 1);
  const headerRow = Math.max(1, Number(cfg.headerRow) || 1);
  const dataEnd = Math.max(headerRow + 1, Number(cfg.dataEnd) || headerRow + 1);
  const keyIndex = keyCol - 1;
  const total = paths.length;

  /** @type {string[]} */
  const headers = [];
  /** @type {Map<string, unknown[]>} */
  const rowMap = new Map();
  /** @type {string[]} */
  const keyOrder = [];
  let width = 0;

  for (let i = 0; i < paths.length; i += 1) {
    const filePath = paths[i];
    const base = path.basename(filePath);
    const stem = path.parse(filePath).name || base;
    cfg.onProgress?.({ index: i + 1, total, name: base });
    const wb = readBook(filePath);
    const names = Array.isArray(wb.SheetNames) ? wb.SheetNames : [];
    if (!names.length) continue;
    const rows = sheetToRows(wb, names[0]);
    if (!rows.length) continue;

    const headerSource = Array.isArray(rows[headerRow - 1]) ? rows[headerRow - 1] : [];
    const header = headerSource.map((cell) => String(cell ?? ''));
    const bodyStart = headerRow; // 0-based index of first data row
    const bodyEndExclusive = Math.min(rows.length, dataEnd); // dataEnd is 1-based inclusive
    /** @type {unknown[][]} */
    const body = [];
    for (let r = bodyStart; r < bodyEndExclusive; r += 1) {
      body.push(Array.isArray(rows[r]) ? rows[r] : []);
    }
    const colCount = Math.max(
      header.length,
      keyCol,
      ...body.map((row) => (Array.isArray(row) ? row.length : 0)),
      1,
    );

    if (i === 0) {
      for (let c = 0; c < colCount; c += 1) {
        headers.push(header[c] || `열${c + 1}`);
      }
      width = colCount;
      for (const row of body) {
        const list = Array.isArray(row) ? row : [];
        const key = String(list[keyIndex] ?? '').trim();
        if (!key) continue;
        if (!rowMap.has(key)) {
          keyOrder.push(key);
          const cells = Array.from({ length: colCount }, (_, c) => list[c] ?? '');
          rowMap.set(key, cells);
        }
      }
      continue;
    }

    const startCol = width;
    for (let c = 0; c < colCount; c += 1) {
      if (c === keyIndex) continue; // 키 열은 중복 생략
      const label = header[c] || `열${c + 1}`;
      headers.push(`${stem}_${label}`);
      width += 1;
    }

    /** @type {Map<string, unknown[]>} */
    const other = new Map();
    for (const row of body) {
      const list = Array.isArray(row) ? row : [];
      const key = String(list[keyIndex] ?? '').trim();
      if (!key) continue;
      other.set(key, list);
    }

    for (const key of keyOrder) {
      const baseRow = rowMap.get(key);
      if (!baseRow) continue;
      while (baseRow.length < startCol) baseRow.push('');
      const match = other.get(key);
      for (let c = 0; c < colCount; c += 1) {
        if (c === keyIndex) continue;
        baseRow.push(match ? match[c] ?? '' : '');
      }
      other.delete(key);
    }

    // 첫 파일에 없던 키는 아래에 추가
    for (const [key, list] of other.entries()) {
      keyOrder.push(key);
      /** @type {unknown[]} */
      const cells = Array.from({ length: startCol }, () => '');
      cells[keyIndex] = key;
      for (let c = 0; c < colCount; c += 1) {
        if (c === keyIndex) continue;
        cells.push(list[c] ?? '');
      }
      rowMap.set(key, cells);
    }
  }

  const target = outWb.addWorksheet(uniqueSheetName('조인', usedNames));
  writeRows(target, [headers], 1);
  let rowNum = 2;
  for (const key of keyOrder) {
    const cells = rowMap.get(key);
    if (!cells) continue;
    while (cells.length < headers.length) cells.push('');
    writeRows(target, [cells.slice(0, headers.length)], rowNum);
    rowNum += 1;
  }
}

/**
 * @param {{
 *   paths: string[],
 *   outputPath: string,
 *   mode?: string,
 *   sheetScope?: string,
 *   sheetNameMode?: string,
 *   keepFirstHeader?: boolean,
 *   addSourceColumn?: boolean,
 *   columnAlign?: string,
 *   headerStart?: number,
 *   headerEnd?: number,
 *   headerRowCount?: number,
 *   sheetFilterText?: string,
 *   namedAction?: string,
 *   keyFrom?: string,
 *   keyTo?: string,
 *   keyColumn?: number,
 *   onProgress?: (info: { index: number, total: number, name: string }) => void,
 * }} options
 */
export async function runExcelMerge(options) {
  const paths = (Array.isArray(options.paths) ? options.paths : [])
    .map((item) => path.resolve(String(item ?? '').trim()))
    .filter(Boolean);
  if (paths.length < 2) {
    throw new Error('병합하려면 Excel 파일이 2개 이상 필요합니다.');
  }
  for (const item of paths) {
    if (!isExcelFile(item)) {
      throw new Error(`Excel 파일이 아닙니다: ${path.basename(item)}`);
    }
    if (!fs.existsSync(item) || !fs.statSync(item).isFile()) {
      throw new Error(`파일을 찾을 수 없습니다: ${path.basename(item)}`);
    }
  }

  const outputPath = path.resolve(String(options.outputPath || '').trim());
  if (!outputPath) throw new Error('저장 경로가 없습니다.');
  if (path.extname(outputPath).toLowerCase() !== '.xlsx') {
    throw new Error('결과 파일은 .xlsx 로만 저장할 수 있습니다.');
  }

  const mode = ALL_MODES.has(String(options.mode)) ? String(options.mode) : MODE_SHEETS;
  const sheetScope = options.sheetScope === SHEET_SCOPE_ALL ? SHEET_SCOPE_ALL : SHEET_SCOPE_FIRST;
  const sheetNameMode =
    options.sheetNameMode === NAME_SHEET || options.sheetNameMode === NAME_FILE_SHEET
      ? options.sheetNameMode
      : NAME_FILE;
  const keepFirstHeader = options.keepFirstHeader !== false;
  const addSourceColumn = options.addSourceColumn === true;
  const columnAlign =
    options.columnAlign === COLUMN_ALIGN_POSITION ? COLUMN_ALIGN_POSITION : COLUMN_ALIGN_HEADER;
  const headerRange = normalizeHeaderRange(
    options.headerStart ?? 1,
    options.headerEnd ?? options.headerStart ?? options.headerRowCount,
  );
  const sheetFilter = parseSheetFilters(options.sheetFilterText);
  const namedAction =
    options.namedAction === NAMED_AS_APPEND ? NAMED_AS_APPEND : NAMED_AS_SHEETS;
  const keyRange = normalizeKeyColumnRange(options.keyFrom, options.keyTo, options.keyColumn);

  const outWb = new ExcelJS.Workbook();
  outWb.creator = 'All In One Tools';
  const usedNames = new Set();
  const onProgress = options.onProgress;

  if (mode === MODE_SHEETS) {
    mergeAsSheets(
      paths,
      { sheetScope, sheetNameMode, onProgress },
      outWb,
      usedNames,
    );
  } else if (mode === MODE_APPEND) {
    mergeAppend(
      paths,
      {
        sheetScope,
        keepFirstHeader,
        addSourceColumn,
        columnAlign,
        headerRange,
        onProgress,
      },
      outWb,
      usedNames,
    );
  } else if (mode === MODE_SAME_NAME) {
    mergeSameName(
      paths,
      { keepFirstHeader, addSourceColumn, columnAlign, headerRange, onProgress },
      outWb,
      usedNames,
    );
  } else if (mode === MODE_NAMED) {
    if (!sheetFilter.length) {
      throw new Error('지정할 시트 이름(또는 번호)을 입력해 주세요.');
    }
    if (namedAction === NAMED_AS_APPEND) {
      mergeAppend(
        paths,
        {
          sheetScope: SHEET_SCOPE_ALL,
          keepFirstHeader,
          addSourceColumn,
          columnAlign,
          headerRange,
          sheetFilter,
          onProgress,
        },
        outWb,
        usedNames,
      );
    } else {
      mergeAsSheets(
        paths,
        {
          sheetScope: SHEET_SCOPE_ALL,
          sheetNameMode: NAME_FILE_SHEET,
          sheetFilter,
          onProgress,
        },
        outWb,
        usedNames,
      );
    }
  } else if (mode === MODE_JOIN) {
    mergeJoin(
      paths,
      {
        keyCol: keyRange.keyCol,
        headerRow: keyRange.headerRow,
        dataEnd: keyRange.dataEnd,
        onProgress,
      },
      outWb,
      usedNames,
    );
  } else if (mode === MODE_FOLDER) {
    const folderRoot = commonParentDir(paths);
    mergeAsSheets(
      paths,
      {
        sheetScope,
        sheetNameMode: sheetNameMode === NAME_SHEET ? NAME_FILE_SHEET : sheetNameMode,
        folderRoot,
        onProgress,
      },
      outWb,
      usedNames,
    );
  }

  if (outWb.worksheets.length === 0) {
    throw new Error('병합할 시트가 없습니다. 시트 이름·필터를 확인해 주세요.');
  }

  const outDir = path.dirname(outputPath);
  if (outDir && !fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }
  if (fs.existsSync(outputPath)) {
    fs.unlinkSync(outputPath);
  }
  await outWb.xlsx.writeFile(outputPath);
  if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size <= 0) {
    throw new Error('결과 파일이 만들어지지 않았습니다.');
  }
  return { outputPath, sheetCount: outWb.worksheets.length };
}
