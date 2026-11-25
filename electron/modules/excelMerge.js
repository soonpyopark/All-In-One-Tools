/**
 * 엑셀 파일 병합 API.
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { app, BrowserWindow, dialog } from 'electron';
import { APP_NAME } from '../../shared/constants.js';
import { ApiError, defineApi } from '../api/registry.js';
import { normalizeHeaderRange } from '../excel/headerRange.js';
import {
  COLUMN_ALIGN_HEADER,
  COLUMN_ALIGN_POSITION,
  EXCEL_EXTENSIONS,
  MODE_APPEND,
  MODE_FOLDER,
  MODE_JOIN,
  MODE_NAMED,
  MODE_SAME_NAME,
  MODE_SHEETS,
  NAME_FILE,
  NAME_FILE_SHEET,
  NAME_SHEET,
  NAMED_AS_APPEND,
  NAMED_AS_SHEETS,
  SHEET_SCOPE_ALL,
  SHEET_SCOPE_FIRST,
  detectHeaderFromFile,
  detectKeyRangeFromFile,
  exportFileSheetSummary,
  inspectExcelFileSheets,
  isExcelFile,
  resolveOutputPath,
  runExcelMerge,
  sanitizeMergeName,
} from '../excelMerge/mergeService.js';

function appMainWindow() {
  const wins = BrowserWindow.getAllWindows().filter((win) => !win.isDestroyed());
  return (
    wins.find((win) => win.getTitle().startsWith(APP_NAME) && !win.isFullScreen()) ??
    wins.find((win) => !win.isFullScreen()) ??
    null
  );
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${String(d.getFullYear()).slice(2)}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/**
 * @typedef {{
 *   id: string,
 *   state: 'running' | 'done' | 'error',
 *   progress: number,
 *   message: string,
 *   index: number,
 *   total: number,
 *   outputPath?: string,
 *   error?: string,
 *   updatedAt: number,
 * }} ExcelMergeJob
 */

/** @type {Map<string, ExcelMergeJob>} */
const jobs = new Map();

/**
 * @param {unknown} raw
 * @returns {string[]}
 */
function normalizePaths(raw) {
  const list = Array.isArray(raw) ? raw : [];
  /** @type {string[]} */
  const out = [];
  const seen = new Set();
  for (const item of list) {
    const value = path.resolve(String(item ?? '').trim());
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    if (!isExcelFile(value)) continue;
    if (!fs.existsSync(value) || !fs.statSync(value).isFile()) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

/**
 * @param {unknown} raw
 */
function normalizeMode(raw) {
  const value = String(raw ?? '');
  const allowed = new Set([
    MODE_SHEETS,
    MODE_APPEND,
    MODE_SAME_NAME,
    MODE_NAMED,
    MODE_JOIN,
    MODE_FOLDER,
  ]);
  return allowed.has(value) ? value : MODE_SHEETS;
}

/**
 * @param {unknown} raw
 */
function normalizeSheetScope(raw) {
  return raw === SHEET_SCOPE_FIRST ? SHEET_SCOPE_FIRST : SHEET_SCOPE_ALL;
}

/**
 * @param {unknown} raw
 */
function normalizeNameMode(raw) {
  if (raw === NAME_SHEET || raw === NAME_FILE_SHEET) return raw;
  return NAME_FILE;
}

/**
 * @param {unknown} raw
 */
function normalizeColumnAlign(raw) {
  return raw === COLUMN_ALIGN_POSITION ? COLUMN_ALIGN_POSITION : COLUMN_ALIGN_HEADER;
}

export function register() {
  defineApi('excelMerge.meta', () => ({
    extensions: EXCEL_EXTENSIONS,
    modes: [
      {
        id: MODE_SHEETS,
        label: '시트로 모으기',
        hint: '각 파일을 결과 .xlsx 의 별도 시트로 넣습니다. 행 데이터는 합치지 않고, 여러 시트를 한 파일에만 모읍니다.',
      },
      {
        id: MODE_APPEND,
        label: '아래로 이어 붙이기',
        hint: '선택한 시트들의 데이터를 한 시트에 위→아래로 붙입니다. 파일 하나(여러 시트)만으로도 가능합니다. 헤더 이름으로 열을 맞추거나, 열 위치로 붙일 수 있습니다.',
      },
      {
        id: MODE_SAME_NAME,
        label: '같은 이름 시트끼리',
        hint: '여러 파일에서 시트 이름이 같은 것끼리 모아, 각각 결과 시트로 아래로 이어 붙입니다. (예: 모든 ‘매출’ → 결과 ‘매출’)',
      },
      {
        id: MODE_NAMED,
        label: '지정 시트만',
        hint: '시트 이름·번호로 고른 시트만 가져옵니다. 처리 방식에서 시트로 모으기 또는 아래로 이어 붙이기를 고릅니다.',
      },
      {
        id: MODE_JOIN,
        label: '키로 옆으로 이어 붙이기',
        hint: '키 열 범위(예: A1~A190)로 헤더·데이터를 정해, 같은 키 행의 열을 가로로 붙입니다. 각 파일의 첫 시트만 씁니다.',
      },
      {
        id: MODE_FOLDER,
        label: '폴더 경로로 시트',
        hint: '시트로 모으기와 같되, 시트 이름 앞에 상대 폴더 경로를 붙입니다. 하위 폴더에 같은 파일 이름이 있어도 구분됩니다.',
      },
    ],
    sheetScopes: [
      { id: SHEET_SCOPE_ALL, label: '각 파일의 모든 시트' },
      { id: SHEET_SCOPE_FIRST, label: '각 파일의 첫 시트만' },
    ],
    sheetNameModes: [
      { id: NAME_FILE, label: '파일 이름' },
      { id: NAME_SHEET, label: '원본 시트 이름' },
      { id: NAME_FILE_SHEET, label: '파일 이름_시트 이름' },
    ],
    namedActions: [
      { id: NAMED_AS_SHEETS, label: '시트로 모으기' },
      { id: NAMED_AS_APPEND, label: '아래로 이어 붙이기' },
    ],
    columnAligns: [
      {
        id: COLUMN_ALIGN_HEADER,
        label: '헤더 이름으로 맞추기',
        hint: '열 순서가 달라도 같은 헤더끼리 맞춥니다.',
      },
      {
        id: COLUMN_ALIGN_POSITION,
        label: '열 위치로 맞추기',
        hint: '왼쪽부터 같은 칸끼리 아래로 이어 붙입니다.',
      },
    ],
    headerRange: { min: 1, maxSpan: 20, defaultStart: 1, defaultEnd: 1 },
    keyRange: { defaultFrom: 'A1', defaultTo: 'A2' },
  }));

  defineApi('excelMerge.detectHeader', (body) => {
    const filePath = path.resolve(String(body?.path ?? '').trim());
    if (!filePath || !isExcelFile(filePath) || !fs.existsSync(filePath)) {
      throw new ApiError('첫 번째 Excel 파일을 확인해 주세요.');
    }
    return detectHeaderFromFile(filePath);
  });

  defineApi('excelMerge.detectKeyRange', (body) => {
    const filePath = path.resolve(String(body?.path ?? '').trim());
    if (!filePath || !isExcelFile(filePath) || !fs.existsSync(filePath)) {
      throw new ApiError('첫 번째 Excel 파일을 확인해 주세요.');
    }
    return detectKeyRangeFromFile(filePath);
  });

  defineApi('excelMerge.inspectFile', (body) => {
    const filePath = path.resolve(String(body?.path ?? '').trim());
    if (!filePath || !isExcelFile(filePath) || !fs.existsSync(filePath)) {
      throw new ApiError('Excel 파일을 확인해 주세요.');
    }
    try {
      return inspectExcelFileSheets(filePath);
    } catch (err) {
      throw new ApiError(err instanceof Error ? err.message : '파일을 읽지 못했습니다.');
    }
  });

  defineApi('excelMerge.exportSheetSummary', async (body) => {
    const paths = normalizePaths(body?.paths);
    if (paths.length < 1) throw new ApiError('내보낼 Excel 파일을 먼저 추가해 주세요.');

    const win = appMainWindow();
    const defaultDir = path.dirname(paths[0]);
    const save = await dialog.showSaveDialog(win ?? undefined, {
      title: '파일·시트 목록 엑셀로 저장',
      defaultPath: path.join(defaultDir, `파일시트목록_${stamp()}.xlsx`),
      filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }],
    });
    if (save.canceled || !save.filePath) return { cancelled: true };
    const outputPath = /\.xlsx$/i.test(save.filePath) ? save.filePath : `${save.filePath}.xlsx`;

    try {
      const result = await exportFileSheetSummary(paths, outputPath);
      return { ok: true, ...result };
    } catch (err) {
      throw new ApiError(err instanceof Error ? err.message : '목록 엑셀 저장에 실패했습니다.');
    }
  });

  defineApi('excelMerge.resolveOutput', (body) => {
    const paths = normalizePaths(body?.paths);
    if (paths.length < 1) throw new ApiError('파일을 먼저 추가해 주세요.');
    const outputName = sanitizeMergeName(body?.outputName);
    const outputDir = typeof body?.outputDir === 'string' ? body.outputDir.trim() : '';
    const outputPath = resolveOutputPath(paths, outputDir, outputName);
    return { outputPath, exists: fs.existsSync(outputPath) };
  });

  defineApi('excelMerge.run', async (body) => {
    const paths = normalizePaths(body?.paths);
    if (paths.length < 1) {
      throw new ApiError('병합할 Excel 파일을 추가해 주세요.');
    }
    const outputName = sanitizeMergeName(body?.outputName);
    const outputDir = typeof body?.outputDir === 'string' ? body.outputDir.trim() : '';
    const outputPath = resolveOutputPath(paths, outputDir, outputName);
    const overwrite = body?.overwrite === true;
    if (fs.existsSync(outputPath) && !overwrite) {
      throw new ApiError('같은 이름의 파일이 이미 있습니다. 덮어쓸지 확인해 주세요.', 409, {
        code: 'OUTPUT_EXISTS',
        outputPath,
      });
    }

    const id = randomUUID();
    /** @type {ExcelMergeJob} */
    const job = {
      id,
      state: 'running',
      progress: 0,
      message: '병합 준비 중…',
      index: 0,
      total: paths.length,
      updatedAt: Date.now(),
    };
    jobs.set(id, job);

    const headerRange = normalizeHeaderRange(body?.headerStart, body?.headerEnd);
    void (async () => {
      try {
        const result = await runExcelMerge({
          paths,
          outputPath,
          mode: normalizeMode(body?.mode),
          sheetScope: normalizeSheetScope(body?.sheetScope),
          sheetNameMode: normalizeNameMode(body?.sheetNameMode),
          keepFirstHeader: body?.keepFirstHeader !== false,
          addSourceColumn: body?.addSourceColumn === true,
          columnAlign: normalizeColumnAlign(body?.columnAlign),
          headerStart: headerRange.start,
          headerEnd: headerRange.end,
          sheetFilterText: typeof body?.sheetFilterText === 'string' ? body.sheetFilterText : '',
          namedAction: body?.namedAction === NAMED_AS_APPEND ? NAMED_AS_APPEND : NAMED_AS_SHEETS,
          keyFrom: typeof body?.keyFrom === 'string' ? body.keyFrom : '',
          keyTo: typeof body?.keyTo === 'string' ? body.keyTo : '',
          keyColumn: Number(body?.keyColumn) || 1,
          onProgress: ({ index, total, name }) => {
            job.index = index;
            job.total = total;
            job.progress = total > 0 ? Math.min(99, Math.round((index / total) * 100)) : 0;
            job.message = name ? `${index}/${total} · ${name}` : `${index}/${total}`;
            job.updatedAt = Date.now();
          },
        });
        job.state = 'done';
        job.progress = 100;
        job.message = '완료';
        job.outputPath = result.outputPath;
        job.updatedAt = Date.now();
      } catch (err) {
        job.state = 'error';
        job.error = err instanceof Error ? err.message : String(err);
        job.message = job.error;
        job.updatedAt = Date.now();
      }
    })();

    return { jobId: id };
  });

  defineApi('excelMerge.job', (body) => {
    const id = String(body?.id ?? '').trim();
    const job = jobs.get(id);
    if (!job) throw new ApiError('작업을 찾을 수 없습니다.');
    return { ...job };
  });
}
