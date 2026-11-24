/**
 * Excel 컬럼 비교 → 하이라이트 결과(.xlsx) 생성.
 * 원본 Excel Compare 로직 + 개선: 시트/헤더/다중키/일치방식/빈칸/진행률.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import ExcelJS from 'exceljs';
import { detectHeaderRange, fillMergedCells, flattenHeaderLabels, normalizeHeaderRange } from '../excel/headerRange.js';
import { createLegacyConvertCache, isLegacyExcelPath } from '../excel/legacyToXlsx.js';

const require = createRequire(import.meta.url);
const XLSX = require('./xlsx.full.min.cjs');

export const MODE_IN_ORIGINAL = 'in-original';
export const MODE_NOT_IN_ORIGINAL = 'not-in-original';
export const MATCH_EXACT = 'exact';
export const MATCH_CONTAINS = 'contains';

export const MODE_LABELS = {
  [MODE_IN_ORIGINAL]:
    '[원본 파일(선택 컬럼)]에 있는 것들을 [비교 파일(선택 컬럼)]에 하이라이트 표시',
  [MODE_NOT_IN_ORIGINAL]:
    '[원본 파일(선택 컬럼)]에 없는 것들을 [비교 파일(선택 컬럼)]에 하이라이트 표시',
};

export const MATCH_LABELS = {
  [MATCH_EXACT]: '완전 일치',
  [MATCH_CONTAINS]: '포함 일치 (비교 값에 원본 값이 포함)',
};

export const HIGHLIGHT_COLOR_ORDER = ['yellow', 'red', 'blue', 'green'];

export const HIGHLIGHT_COLORS = {
  yellow: { label: '노란색', argb: 'FFFFF2CC', swatch: '#FFF2CC' },
  red: { label: '빨간색', argb: 'FFFBE2D5', swatch: '#FBE2D5' },
  blue: { label: '파란색', argb: 'FFCAEDFB', swatch: '#CAEDFB' },
  green: { label: '초록색', argb: 'FFDAF2D0', swatch: '#DAF2D0' },
};

const OPENXML = new Set(['.xlsx', '.xlsm', '.xltx', '.xltm']);
const LEGACY_XLS = new Set(['.xls', '.xlt']);
const XLSB = new Set(['.xlsb']);
export const SUPPORTED_EXTENSIONS = [...OPENXML, ...LEGACY_XLS, ...XLSB];

const SHEET_ORIGINAL = '원본';
const SHEET_COMPARE = '비교';
const SHEET_RESULT = '결과';
const KEY_SEP = '\u0001';

/** 결과 파일 기본 격자 테두리 (진한 회색 실선) */
const GRID_BORDER_ARGB = 'FF595959';

function extOf(filePath) {
  return path.extname(String(filePath ?? '')).toLowerCase();
}

export function ensureSupported(filePath) {
  const ext = extOf(filePath);
  if (!SUPPORTED_EXTENSIONS.includes(ext)) {
    throw new Error(`지원하지 않는 파일 형식입니다: ${ext || '(없음)'}\n지원: ${SUPPORTED_EXTENSIONS.join(', ')}`);
  }
  return ext;
}

export function isLegacyFormat(filePath) {
  const ext = extOf(filePath);
  return LEGACY_XLS.has(ext) || XLSB.has(ext);
}

/**
 * ExcelJS/SheetJS 셀 값을 비교 키용 문자열로 통일합니다.
 * rich text·수식 결과·하이퍼링크 등을 풀지 않으면 "[object Object]" 가 되어 하이라이트가 전부 빠집니다.
 * @param {unknown} value
 */
export function normalizeCellValue(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Number.isInteger(value) ? String(value) : String(value);
  }
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === 'object') {
    const obj = /** @type {Record<string, unknown>} */ (value);
    if (Array.isArray(obj.richText)) {
      return obj.richText.map((part) => String(part?.text ?? '')).join('').trim();
    }
    if ('text' in obj) return String(obj.text ?? '').trim();
    if ('result' in obj) return normalizeCellValue(obj.result);
    if ('error' in obj) return String(obj.error ?? '').trim();
  }
  return String(value).trim();
}

/** @param {unknown} value */
function deepCloneJson(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return undefined;
  }
}

/**
 * 셀 서식을 참조 공유 없이 복사합니다. (ExcelJS 공유 스타일 부작용 방지)
 * @param {import('exceljs').Cell} source
 * @param {import('exceljs').Cell} target
 */
function copyCellStyle(source, target) {
  if (source.numFmt) target.numFmt = source.numFmt;
  if (source.font) {
    const font = deepCloneJson(source.font);
    if (font) target.font = font;
  }
  if (source.alignment) {
    const alignment = deepCloneJson(source.alignment);
    if (alignment) target.alignment = alignment;
  }
  if (source.border) {
    const border = deepCloneJson(source.border);
    if (border) target.border = border;
  }
  const fill = source.fill;
  if (fill && fill.type === 'pattern' && fill.pattern && fill.pattern !== 'none') {
    const cloned = deepCloneJson(fill);
    if (cloned) target.fill = cloned;
  } else if (fill && fill.type === 'gradient') {
    const cloned = deepCloneJson(fill);
    if (cloned) target.fill = cloned;
  }
  if (source.protection) {
    const protection = deepCloneJson(source.protection);
    if (protection) target.protection = protection;
  }
}

function colLetter(index1) {
  let n = index1;
  let s = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** @param {unknown} raw */
export function normalizeColList(raw) {
  const list = Array.isArray(raw) ? raw : raw != null && raw !== '' ? [raw] : [];
  /** @type {number[]} */
  const out = [];
  const seen = new Set();
  for (const item of list) {
    const n = Number(item);
    if (!Number.isInteger(n) || n < 1 || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
    if (out.length >= 8) break;
  }
  return out;
}

/**
 * @param {string} value
 * @param {Set<string>} originalValues
 * @param {string} matchKind
 */
export function isValueInOriginal(value, originalValues, matchKind = MATCH_EXACT) {
  if (originalValues.has(value)) return true;
  if (matchKind !== MATCH_CONTAINS || !value) return false;
  for (const original of originalValues) {
    if (original && value.includes(original)) return true;
  }
  return false;
}

/**
 * @param {string} value
 * @param {Set<string>} originalValues
 * @param {string} mode
 * @param {string} matchKind
 */
export function shouldHighlight(value, originalValues, mode, matchKind = MATCH_EXACT) {
  const inOriginal = isValueInOriginal(value, originalValues, matchKind);
  return mode === MODE_IN_ORIGINAL ? inOriginal : !inOriginal;
}

/** @param {(pct: number, message: string) => void} [onProgress] */
function report(onProgress, pct, message) {
  try {
    onProgress?.(Math.max(0, Math.min(100, Math.round(pct))), message);
  } catch {
    // ignore
  }
}

function readXlsxBook(filePath) {
  const buf = fs.readFileSync(filePath);
  return XLSX.read(buf, { type: 'buffer', cellDates: true, dense: false });
}

/**
 * @param {string} filePath
 * @returns {{ index: number, name: string }[]}
 */
export function listSheets(filePath) {
  ensureSupported(filePath);
  const ext = extOf(filePath);
  if (OPENXML.has(ext)) {
    // SheetJS 로 이름만 빠르게 (ExcelJS full load 없이)
    const wb = readXlsxBook(filePath);
    return (wb.SheetNames || []).map((name, index) => ({ index, name: String(name) }));
  }
  const wb = readXlsxBook(filePath);
  return (wb.SheetNames || []).map((name, index) => ({ index, name: String(name) }));
}

/**
 * @param {string} filePath
 * @param {number} sheetIndex
 * @returns {unknown[][]}
 */
function readSheetRows(filePath, sheetIndex = 0) {
  const wb = readXlsxBook(filePath);
  const name = wb.SheetNames[sheetIndex] ?? wb.SheetNames[0];
  if (!name) return [];
  return XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '', raw: false });
}

/**
 * 시트 앞부분을 점수화해 헤더 행(1-based)을 고릅니다.
 * @param {unknown[][]} rows
 * @param {number} [maxScan]
 * @returns {number}
 */
export function detectHeaderRow(rows, maxScan = 30) {
  const list = Array.isArray(rows) ? rows : [];
  if (list.length === 0) return 1;
  const limit = Math.min(list.length, Math.max(1, Number(maxScan) || 30));

  /** @param {unknown[]} row */
  const cells = (row) => (Array.isArray(row) ? row : []).map((cell) => normalizeCellValue(cell));
  /** @param {string[]} parts */
  const filledCount = (parts) => parts.filter((p) => p.length > 0).length;
  /** @param {string} value */
  const isPureNumber = (value) => /^-?\d+(\.\d+)?$/.test(value);

  let bestRow = 1;
  let bestScore = -1;

  for (let i = 0; i < limit; i += 1) {
    const parts = cells(list[i]);
    const filled = filledCount(parts);
    if (filled === 0) continue;

    const textish = parts.filter((p) => p && !isPureNumber(p)).length;
    const textRatio = filled > 0 ? textish / filled : 0;
    const nextParts = i + 1 < list.length ? cells(list[i + 1]) : [];
    const nextFilled = filledCount(nextParts);
    const nextBoost = nextFilled >= Math.max(1, Math.ceil(filled * 0.5)) ? 2 : 0;

    // 비어 있지 않은 칸 + 문자 비율 + 다음 행이 데이터처럼 채워진 경우
    const score = filled * 2 + textRatio * 4 + nextBoost;
    if (score > bestScore) {
      bestScore = score;
      bestRow = i + 1;
    }
  }

  return bestRow;
}

/**
 * @param {string} filePath
 * @param {number} sheetIndex
 * @returns {{ rows: unknown[][], merges: any[] }}
 */
function readSheetGrid(filePath, sheetIndex = 0) {
  const wb = readXlsxBook(filePath);
  const name = wb.SheetNames[sheetIndex] ?? wb.SheetNames[0];
  if (!name || !wb.Sheets[name]) return { rows: [], merges: [] };
  const sheet = wb.Sheets[name];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
  return {
    rows: Array.isArray(rows) ? rows : [],
    merges: Array.isArray(sheet['!merges']) ? sheet['!merges'] : [],
  };
}

/**
 * 파일 미리보기: 시트 목록 + (선택 시트·헤더 범위 기준) 컬럼.
 * 자동 인식은 이 파일의 선택 시트에서 헤더 시작·끝 행을 고릅니다.
 * @param {{
 *   path: string,
 *   sheetIndex?: number,
 *   headerRow?: number,
 *   headerStart?: number,
 *   headerEnd?: number,
 *   headerColStart?: number,
 *   headerColEnd?: number,
 *   autoHeader?: boolean,
 * }} options
 */
export async function inspectFile(options) {
  const filePath = path.resolve(String(options.path ?? ''));
  ensureSupported(filePath);
  const sheets = listSheets(filePath);
  if (!sheets.length) {
    return {
      sheets: [],
      sheetIndex: 0,
      headerRow: 1,
      headerStart: 1,
      headerEnd: 1,
      headerColStart: 1,
      headerColEnd: 1,
      headerAutoDetected: false,
      columns: [],
      legacy: isLegacyFormat(filePath),
    };
  }
  let sheetIndex = Number(options.sheetIndex);
  if (!Number.isInteger(sheetIndex) || sheetIndex < 0 || sheetIndex >= sheets.length) sheetIndex = 0;

  const grid = readSheetGrid(filePath, sheetIndex);
  const rows = fillMergedCells(grid.rows, grid.merges);
  const autoHeader = options.autoHeader === true;
  let headerStart = 1;
  let headerEnd = 1;
  let headerColStart = 1;
  let headerColEnd = 1;
  let headerAutoDetected = false;
  if (autoHeader) {
    const detected = detectHeaderRange(rows, { merges: grid.merges, rawRows: grid.rows });
    headerStart = detected.start;
    headerEnd = detected.end;
    headerColStart = detected.colStart;
    headerColEnd = detected.colEnd;
    headerAutoDetected = true;
  } else {
    const normalized = normalizeHeaderRange(
      options.headerStart ?? options.headerRow,
      options.headerEnd ?? options.headerRow ?? options.headerStart,
    );
    headerStart = normalized.start;
    headerEnd = normalized.end;
    headerColStart = Math.max(1, Number(options.headerColStart) || 1);
    headerColEnd = Math.max(headerColStart, Number(options.headerColEnd) || headerColStart);
  }

  const labels = flattenHeaderLabels(rows, headerStart, headerEnd);
  let width = Math.max(labels.length, headerColEnd);
  for (let i = headerEnd; i < Math.min(rows.length, headerEnd + 50); i += 1) {
    width = Math.max(width, (rows[i] || []).length);
  }
  width = Math.max(width, 1);
  headerColEnd = Math.min(headerColEnd, width);

  /** @type {{ label: string, index: number }[]} */
  const columns = [];
  for (let col = headerColStart; col <= headerColEnd; col += 1) {
    const title = normalizeCellValue(labels[col - 1]);
    const letter = colLetter(col);
    columns.push({ label: title ? `${letter} - ${title}` : letter, index: col });
  }

  return {
    sheets,
    sheetIndex,
    headerRow: headerEnd,
    headerStart,
    headerEnd,
    headerColStart,
    headerColEnd,
    headerAutoDetected,
    columns,
    rowCount: Math.max(0, rows.length - headerEnd),
    legacy: isLegacyFormat(filePath),
  };
}

/**
 * @param {unknown[][]} rows
 * @param {number} headerRow 1-based
 * @param {number[]} cols
 * @param {{ skipEmpty?: boolean }} [opts]
 */
function collectKeysFromRows(rows, headerRow, cols, opts = {}) {
  /** @type {Set<string>} */
  const values = new Set();
  let scanned = 0;
  let skippedEmpty = 0;
  for (let i = headerRow; i < rows.length; i += 1) {
    scanned += 1;
    const parts = cols.map((c) => normalizeCellValue(rows[i]?.[c - 1]));
    if (opts.skipEmpty && parts.some((p) => !p)) {
      skippedEmpty += 1;
      continue;
    }
    values.add(parts.join(KEY_SEP));
  }
  return { values, scanned, skippedEmpty };
}

/**
 * @param {import('exceljs').Worksheet} sheet
 * @param {number} headerRow
 * @param {number[]} cols
 * @param {{ skipEmpty?: boolean }} [opts]
 */
function collectKeysFromExcelJs(sheet, headerRow, cols, opts = {}) {
  /** @type {Set<string>} */
  const values = new Set();
  let scanned = 0;
  let skippedEmpty = 0;
  const maxRow = Math.max(sheet.actualRowCount || sheet.rowCount || headerRow, headerRow);
  for (let row = headerRow + 1; row <= maxRow; row += 1) {
    scanned += 1;
    const excelRow = sheet.getRow(row);
    const parts = cols.map((c) => normalizeCellValue(excelRow.getCell(c).value));
    if (opts.skipEmpty && parts.some((p) => !p)) {
      skippedEmpty += 1;
      continue;
    }
    values.add(parts.join(KEY_SEP));
  }
  return { values, scanned, skippedEmpty };
}

/**
 * @param {import('exceljs').Worksheet} source
 * @param {import('exceljs').Workbook} targetWb
 * @param {string} title
 */
function copyWorksheet(source, targetWb, title) {
  const target = targetWb.addWorksheet(title.slice(0, 31));

  source.columns?.forEach((col, idx) => {
    if (!col) return;
    const out = target.getColumn(idx + 1);
    if (col.width != null) out.width = col.width;
    if (col.hidden != null) out.hidden = col.hidden;
  });

  source.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    const outRow = target.getRow(rowNumber);
    if (row.height != null) outRow.height = row.height;
    if (row.hidden != null) outRow.hidden = row.hidden;
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const outCell = outRow.getCell(colNumber);
      outCell.value = cell.value;
      copyCellStyle(cell, outCell);
    });
  });

  if (Array.isArray(source.model?.merges)) {
    for (const merge of source.model.merges) {
      try {
        target.mergeCells(merge);
      } catch {
        // ignore
      }
    }
  }
  if (source.views?.length) target.views = JSON.parse(JSON.stringify(source.views));
  return target;
}

/**
 * @param {unknown[][]} rows
 * @param {import('exceljs').Workbook} targetWb
 * @param {string} title
 */
function rowsToWorksheet(rows, targetWb, title) {
  const target = targetWb.addWorksheet(title.slice(0, 31));
  const maxCols = rows.reduce((m, row) => Math.max(m, (row || []).length), 0);
  for (let c = 1; c <= maxCols; c += 1) {
    target.getColumn(c).width = 14;
  }
  rows.forEach((row, rIdx) => {
    const outRow = target.getRow(rIdx + 1);
    (row || []).forEach((value, cIdx) => {
      outRow.getCell(cIdx + 1).value = value === '' ? null : value;
    });
  });
  return target;
}

/**
 * @param {string} filePath
 * @param {number} sheetIndex
 * @param {import('exceljs').Workbook} targetWb
 * @param {string} title
 * @param {(pct: number, message: string) => void} [onProgress]
 * @param {number} [progressBase]
 * @param {number} [progressSpan]
 * @param {{ resolveOpenXml?: (p: string) => Promise<string> }} [convert]
 */
async function addSheetFromFile(
  filePath,
  sheetIndex,
  targetWb,
  title,
  onProgress,
  progressBase = 0,
  progressSpan = 20,
  convert = undefined,
) {
  report(onProgress, progressBase, `${title} 시트 준비…`);
  let openPath = filePath;
  let usedLegacyConvert = false;
  if (!OPENXML.has(extOf(filePath)) && convert?.resolveOpenXml) {
    report(onProgress, progressBase + progressSpan * 0.2, `${title}: 서식 유지 변환…`);
    const resolved = await convert.resolveOpenXml(filePath);
    if (resolved && OPENXML.has(extOf(resolved)) && resolved !== filePath) {
      openPath = resolved;
      usedLegacyConvert = true;
    }
  }

  if (OPENXML.has(extOf(openPath))) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(openPath);
    const sheet = wb.worksheets[sheetIndex] ?? wb.worksheets[0];
    if (!sheet) throw new Error(`${path.basename(filePath)} 에 시트가 없습니다.`);
    const copied = copyWorksheet(sheet, targetWb, title);
    report(
      onProgress,
      progressBase + progressSpan,
      usedLegacyConvert ? `${title} 시트 복사 완료 (서식 유지)` : `${title} 시트 복사 완료`,
    );
    return copied;
  }

  // Excel COM 변환 실패 시 값만 이전
  const rows = readSheetRows(filePath, sheetIndex);
  const copied = rowsToWorksheet(rows, targetWb, title);
  report(onProgress, progressBase + progressSpan, `${title} 시트 변환 완료 (값 위주)`);
  return copied;
}

/**
 * @param {import('exceljs').Worksheet} sheet
 * @param {{
 *   headerRow: number,
 *   cols: number[],
 *   originalValues: Set<string>,
 *   mode: string,
 *   matchKind: string,
 *   skipEmpty: boolean,
 *   colorKey: string,
 *   onProgress?: (pct: number, message: string) => void,
 * }} opts
 */
/**
 * 사용 범위에 진한 회색 실선 테두리를 넣습니다.
 * @param {import('exceljs').Worksheet} sheet
 */
function applyGridBorders(sheet) {
  let maxRow = 0;
  let maxCol = 0;
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    maxRow = Math.max(maxRow, rowNumber);
    row.eachCell({ includeEmpty: false }, (_cell, colNumber) => {
      maxCol = Math.max(maxCol, colNumber);
    });
  });
  if (maxRow < 1 || maxCol < 1) return;

  for (let r = 1; r <= maxRow; r += 1) {
    const excelRow = sheet.getRow(r);
    for (let c = 1; c <= maxCol; c += 1) {
      const cell = excelRow.getCell(c);
      // 칸마다 새 객체 — ExcelJS 공유 스타일로 테두리가 섞이지 않게
      cell.border = {
        top: { style: 'thin', color: { argb: GRID_BORDER_ARGB } },
        left: { style: 'thin', color: { argb: GRID_BORDER_ARGB } },
        bottom: { style: 'thin', color: { argb: GRID_BORDER_ARGB } },
        right: { style: 'thin', color: { argb: GRID_BORDER_ARGB } },
      };
    }
  }
}

function applyHighlights(sheet, opts) {
  const {
    headerRow,
    cols,
    originalValues,
    mode,
    matchKind,
    skipEmpty,
    colorKey,
    onProgress,
  } = opts;
  const argb = HIGHLIGHT_COLORS[colorKey]?.argb || HIGHLIGHT_COLORS.yellow.argb;
  let highlighted = 0;
  let total = 0;
  let skippedEmpty = 0;
  const maxRow = Math.max(sheet.actualRowCount || sheet.rowCount || headerRow, headerRow);
  const dataRows = Math.max(0, maxRow - headerRow);
  const tickEvery = Math.max(1, Math.floor(dataRows / 40) || 1);

  for (let row = headerRow + 1; row <= maxRow; row += 1) {
    const excelRow = sheet.getRow(row);
    const parts = cols.map((c) => normalizeCellValue(excelRow.getCell(c).value));
    if (skipEmpty && parts.some((p) => !p)) {
      skippedEmpty += 1;
      continue;
    }
    const value = parts.join(KEY_SEP);
    total += 1;
    if (shouldHighlight(value, originalValues, mode, matchKind)) {
      for (const c of cols) {
        const cell = excelRow.getCell(c);
        // style 객체 공유·shallow copy 를 피하고 fill 만 새로 지정 (Excel에서 배경이 빠지는 문제 방지)
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb },
        };
      }
      highlighted += 1;
    }
    if ((row - headerRow) % tickEvery === 0) {
      const pct = 70 + ((row - headerRow) / Math.max(dataRows, 1)) * 20;
      report(onProgress, pct, `하이라이트 ${row - headerRow}/${dataRows}행…`);
    }
  }
  return { highlighted, total, skippedEmpty };
}

/**
 * @param {{
 *   originalPath: string,
 *   comparePath: string,
 *   originalSheetIndex?: number,
 *   compareSheetIndex?: number,
 *   headerRow?: number,
 *   compareHeaderRow?: number,
 *   originalCols: number[],
 *   compareCols: number[],
 *   mode?: string,
 *   matchKind?: string,
 *   skipEmpty?: boolean,
 *   color?: string,
 *   outputPath: string,
 *   onProgress?: (pct: number, message: string) => void,
 * }} options
 */
export async function runCompare(options) {
  const originalPath = path.resolve(options.originalPath);
  const comparePath = path.resolve(options.comparePath);
  const outputPath = path.resolve(options.outputPath);
  const originalCols = normalizeColList(options.originalCols);
  const compareCols = normalizeColList(options.compareCols);
  const originalSheetIndex = Number.isInteger(Number(options.originalSheetIndex))
    ? Number(options.originalSheetIndex)
    : 0;
  const compareSheetIndex = Number.isInteger(Number(options.compareSheetIndex))
    ? Number(options.compareSheetIndex)
    : 0;
  const headerRow = Math.max(1, Number(options.headerRow) || 1);
  const compareHeaderRow = Math.max(1, Number(options.compareHeaderRow) || headerRow);
  const mode = options.mode === MODE_NOT_IN_ORIGINAL ? MODE_NOT_IN_ORIGINAL : MODE_IN_ORIGINAL;
  const matchKind = options.matchKind === MATCH_CONTAINS ? MATCH_CONTAINS : MATCH_EXACT;
  const skipEmpty = options.skipEmpty !== false;
  const color = HIGHLIGHT_COLORS[options.color] ? String(options.color) : 'yellow';
  const onProgress = options.onProgress;

  if (!fs.existsSync(originalPath)) throw new Error('원본 파일을 찾을 수 없습니다.');
  if (!fs.existsSync(comparePath)) throw new Error('비교 파일을 찾을 수 없습니다.');
  ensureSupported(originalPath);
  ensureSupported(comparePath);
  if (extOf(outputPath) !== '.xlsx') throw new Error('결과 파일은 .xlsx 형식으로만 저장할 수 있습니다.');
  if (!originalCols.length) throw new Error('원본 비교 컬럼을 선택해 주세요.');
  if (!compareCols.length) throw new Error('비교 파일 컬럼을 선택해 주세요.');
  if (originalCols.length !== compareCols.length) {
    throw new Error(`원본·비교 컬럼 개수가 같아야 합니다. (원본 ${originalCols.length}, 비교 ${compareCols.length})`);
  }

  report(onProgress, 5, '원본 키 수집…');
  let originalValues;
  let originalScanned = 0;
  let originalSkipped = 0;
  if (OPENXML.has(extOf(originalPath))) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(originalPath);
    const sheet = wb.worksheets[originalSheetIndex] ?? wb.worksheets[0];
    if (!sheet) throw new Error('원본 시트를 찾을 수 없습니다.');
    const collected = collectKeysFromExcelJs(sheet, headerRow, originalCols, { skipEmpty });
    originalValues = collected.values;
    originalScanned = collected.scanned;
    originalSkipped = collected.skippedEmpty;
  } else {
    const rows = readSheetRows(originalPath, originalSheetIndex);
    const collected = collectKeysFromRows(rows, headerRow, originalCols, { skipEmpty });
    originalValues = collected.values;
    originalScanned = collected.scanned;
    originalSkipped = collected.skippedEmpty;
  }
  report(onProgress, 20, `원본 키 ${originalValues.size}개 (스캔 ${originalScanned}, 빈칸 제외 ${originalSkipped})`);

  const legacyCache = createLegacyConvertCache();
  try {
    if (isLegacyExcelPath(comparePath) || isLegacyExcelPath(originalPath)) {
      report(onProgress, 22, '레거시 Excel 서식 변환 준비…');
    }

    const outWb = new ExcelJS.Workbook();
    outWb.creator = 'All In One Tools';
    outWb.created = new Date();

    // 시트 순서: 결과 → 원본 → 비교 (.xls 등은 Excel COM 으로 서식 유지 변환 후 복사)
    const resultSheet = await addSheetFromFile(
      comparePath,
      compareSheetIndex,
      outWb,
      SHEET_RESULT,
      onProgress,
      25,
      15,
      legacyCache,
    );
    await addSheetFromFile(
      originalPath,
      originalSheetIndex,
      outWb,
      SHEET_ORIGINAL,
      onProgress,
      40,
      15,
      legacyCache,
    );
    await addSheetFromFile(
      comparePath,
      compareSheetIndex,
      outWb,
      SHEET_COMPARE,
      onProgress,
      55,
      15,
      legacyCache,
    );

    report(onProgress, 70, '결과 시트 하이라이트…');
    const { highlighted, total, skippedEmpty } = applyHighlights(resultSheet, {
      headerRow: compareHeaderRow,
      cols: compareCols,
      originalValues,
      mode,
      matchKind,
      skipEmpty,
      colorKey: color,
      onProgress,
    });

    // 격자 테두리는 결과 시트에만 — 원본·비교 시트는 소스 파일 서식 유지
    report(onProgress, 88, '결과 시트 테두리…');
    applyGridBorders(resultSheet);

    report(onProgress, 92, '결과 파일 저장…');
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    await outWb.xlsx.writeFile(outputPath);
    report(onProgress, 100, '완료');

    return {
      outputPath,
      highlighted,
      total,
      skippedEmpty,
      originalValueCount: originalValues.size,
      originalScanned,
      originalSkippedEmpty: originalSkipped,
      mode,
      matchKind,
      skipEmpty,
      color,
      originalCols,
      compareCols,
      legacyOriginal: isLegacyFormat(originalPath),
      legacyCompare: isLegacyFormat(comparePath),
    };
  } finally {
    legacyCache.cleanup();
  }
}

/** @param {string} comparePath */
export function defaultOutputName(comparePath) {
  const stamp = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const tag = `${String(stamp.getFullYear()).slice(2)}${pad(stamp.getMonth() + 1)}${pad(stamp.getDate())}_${pad(stamp.getHours())}${pad(stamp.getMinutes())}${pad(stamp.getSeconds())}`;
  return `${path.parse(comparePath).name}_highlighted_${tag}.xlsx`;
}
