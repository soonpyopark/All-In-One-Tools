/**
 * Excel 컬럼 비교 API (시트/헤더/다중키/일치방식/빈칸/진행률).
 */
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { BrowserWindow, dialog, shell } from 'electron';
import { APP_NAME } from '../../shared/constants.js';
import { ApiError, defineApi } from '../api/registry.js';
import {
  HIGHLIGHT_COLOR_ORDER,
  HIGHLIGHT_COLORS,
  MATCH_CONTAINS,
  MATCH_EXACT,
  MATCH_LABELS,
  MODE_IN_ORIGINAL,
  MODE_LABELS,
  MODE_NOT_IN_ORIGINAL,
  SUPPORTED_EXTENSIONS,
  defaultOutputName,
  inspectFile,
  normalizeColList,
  runCompare,
} from '../excelCompare/compareService.js';

/** @returns {import('electron').BrowserWindow | null} */
function appMainWindow() {
  const wins = BrowserWindow.getAllWindows().filter((win) => !win.isDestroyed());
  return (
    wins.find((win) => win.getTitle().startsWith(APP_NAME) && !win.isFullScreen()) ??
    wins.find((win) => !win.isFullScreen()) ??
    null
  );
}

const EXCEL_FILTERS = [
  {
    name: 'Excel',
    extensions: SUPPORTED_EXTENSIONS.map((ext) => ext.replace(/^\./, '')),
  },
];

/**
 * @typedef {{
 *   id: string,
 *   state: 'queued' | 'running' | 'done' | 'error',
 *   progress: number,
 *   message: string,
 *   logs: string[],
 *   result?: any,
 *   error?: string,
 *   updatedAt: number,
 * }} CompareJob
 */

/** @type {Map<string, CompareJob>} */
const jobs = new Map();

function pushJobLog(job, line) {
  job.logs.push(line);
  if (job.logs.length > 200) job.logs.splice(0, job.logs.length - 200);
  job.updatedAt = Date.now();
}

export function register() {
  defineApi('excelCompare.meta', () => ({
    modes: [
      { id: MODE_IN_ORIGINAL, label: MODE_LABELS[MODE_IN_ORIGINAL] },
      { id: MODE_NOT_IN_ORIGINAL, label: MODE_LABELS[MODE_NOT_IN_ORIGINAL] },
    ],
    matchKinds: [
      { id: MATCH_EXACT, label: MATCH_LABELS[MATCH_EXACT] },
      { id: MATCH_CONTAINS, label: MATCH_LABELS[MATCH_CONTAINS] },
    ],
    colors: HIGHLIGHT_COLOR_ORDER.map((id) => ({
      id,
      label: HIGHLIGHT_COLORS[id].label,
      swatch: HIGHLIGHT_COLORS[id].swatch,
    })),
    extensions: SUPPORTED_EXTENSIONS,
  }));

  defineApi('excelCompare.pickFile', async (body) => {
    const role = body?.role === 'compare' ? 'compare' : 'original';
    const win = appMainWindow();
    const result = await dialog.showOpenDialog(win ?? undefined, {
      title: role === 'compare' ? '비교 파일 선택' : '원본 파일 선택',
      properties: ['openFile'],
      filters: EXCEL_FILTERS,
    });
    if (result.canceled || !result.filePaths[0]) return { cancelled: true };
    return { path: result.filePaths[0], name: path.basename(result.filePaths[0]) };
  });

  defineApi('excelCompare.inspect', async (body) => {
    const filePath = String(body?.path ?? '').trim();
    if (!filePath) throw new ApiError('파일 경로가 비어 있습니다.');
    try {
      return await inspectFile({
        path: filePath,
        sheetIndex: body?.sheetIndex,
        headerRow: body?.headerRow,
        headerStart: body?.headerStart,
        headerEnd: body?.headerEnd,
        headerColStart: body?.headerColStart,
        headerColEnd: body?.headerColEnd,
        autoHeader: body?.autoHeader === true,
      });
    } catch (err) {
      throw new ApiError(err instanceof Error ? err.message : String(err));
    }
  });

  defineApi('excelCompare.start', async (body) => {
    const originalPath = String(body?.originalPath ?? '').trim();
    const comparePath = String(body?.comparePath ?? '').trim();
    if (!originalPath || !comparePath) throw new ApiError('원본·비교 파일을 모두 선택해 주세요.');

    let outputPath = String(body?.outputPath ?? '').trim();
    if (!outputPath) {
      const win = appMainWindow();
      const save = await dialog.showSaveDialog(win ?? undefined, {
        title: '결과 파일 저장',
        defaultPath: path.join(path.dirname(comparePath), defaultOutputName(comparePath)),
        filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }],
      });
      if (save.canceled || !save.filePath) return { cancelled: true };
      outputPath = save.filePath.endsWith('.xlsx') ? save.filePath : `${save.filePath}.xlsx`;
    }

    const id = randomUUID();
    /** @type {CompareJob} */
    const job = {
      id,
      state: 'queued',
      progress: 0,
      message: '대기 중…',
      logs: [],
      updatedAt: Date.now(),
    };
    jobs.set(id, job);

    const payload = {
      originalPath,
      comparePath,
      outputPath,
      originalSheetIndex: Number(body?.originalSheetIndex) || 0,
      compareSheetIndex: Number(body?.compareSheetIndex) || 0,
      headerRow: Number(body?.headerRow) || 1,
      compareHeaderRow: Number(body?.compareHeaderRow) || Number(body?.headerRow) || 1,
      originalCols: normalizeColList(body?.originalCols ?? body?.originalCol),
      compareCols: normalizeColList(body?.compareCols ?? body?.compareCol),
      mode: String(body?.mode ?? MODE_IN_ORIGINAL),
      matchKind: String(body?.matchKind ?? MATCH_EXACT),
      skipEmpty: body?.skipEmpty !== false,
      color: String(body?.color ?? 'yellow'),
    };

    setImmediate(() => {
      const current = jobs.get(id);
      if (!current) return;
      current.state = 'running';
      current.message = '비교 시작…';
      pushJobLog(current, '비교 시작');
      void runCompare({
        ...payload,
        onProgress: (pct, message) => {
          const j = jobs.get(id);
          if (!j) return;
          j.progress = pct;
          j.message = message;
          j.updatedAt = Date.now();
          if (pct === 0 || pct === 100 || pct % 10 < 3) pushJobLog(j, `${pct}% ${message}`);
        },
      })
        .then((result) => {
          const j = jobs.get(id);
          if (!j) return;
          j.state = 'done';
          j.progress = 100;
          j.message = '완료';
          j.result = result;
          pushJobLog(
            j,
            `완료: 하이라이트 ${result.highlighted}/${result.total}행 · 원본 키 ${result.originalValueCount}개`,
          );
          if (result.legacyOriginal || result.legacyCompare) {
            pushJobLog(j, '참고: .xls/.xlsb 는 값 위주로 옮겨져 일부 서식이 빠질 수 있습니다.');
          }
        })
        .catch((err) => {
          const j = jobs.get(id);
          if (!j) return;
          j.state = 'error';
          j.error = err instanceof Error ? err.message : String(err);
          j.message = j.error;
          pushJobLog(j, `실패: ${j.error}`);
        });
    });

    return { jobId: id };
  });

  defineApi('excelCompare.job', (body) => {
    const id = String(body?.jobId ?? '').trim();
    const job = jobs.get(id);
    if (!job) throw new ApiError('작업을 찾을 수 없습니다.', 404);
    return {
      id: job.id,
      state: job.state,
      progress: job.progress,
      message: job.message,
      logs: job.logs,
      result: job.result ?? null,
      error: job.error ?? null,
    };
  });

  defineApi('excelCompare.reveal', async (body) => {
    const target = String(body?.path ?? '').trim();
    if (!target) throw new ApiError('경로가 비어 있습니다.');
    shell.showItemInFolder(path.resolve(target));
    return { ok: true };
  });
}
