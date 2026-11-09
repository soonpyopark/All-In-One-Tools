import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { processEbookExtract } from './ebookExtract.js';
import { processPdfDedup } from './pdfDedup.js';

/**
 * @typedef {'queued' | 'running' | 'done' | 'error' | 'cancelled'} JobState
 *
 * @typedef {{
 *   id: string,
 *   kind: 'pdf-dedup' | 'ebook-extract',
 *   label: string,
 *   inputPaths: string[],
 *   outputPath: string,
 *   state: JobState,
 *   progress: number,
 *   error: string,
 *   result: Record<string, unknown> | null,
 *   logs: string[],
 *   createdAt: number,
 *   updatedAt: number,
 *   finishedAt: number | null,
 * }} CleanupJob
 */

/** @type {Map<string, CleanupJob>} */
const jobs = new Map();
/** @type {Map<string, AbortController>} */
const controllers = new Map();
/** @type {string[]} */
const waitQueue = [];
let active = false;

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** @param {CleanupJob} job */
function publicJob(job) {
  return structuredClone(job);
}

function pump() {
  if (active || waitQueue.length === 0) return;
  const id = waitQueue.shift();
  if (!id) return;
  const job = jobs.get(id);
  if (!job || job.state !== 'queued') {
    pump();
    return;
  }
  active = true;
  void runJob(job).finally(() => {
    active = false;
    pump();
  });
}

/**
 * @param {CleanupJob} job
 */
async function runJob(job) {
  const controller = controllers.get(job.id);
  if (!controller) {
    job.state = 'error';
    job.error = '작업을 초기화하지 못했습니다.';
    job.finishedAt = Date.now();
    job.updatedAt = job.finishedAt;
    return;
  }

  job.state = 'running';
  job.updatedAt = Date.now();
  const options = /** @type {Record<string, unknown>} */ (job.result?.options || {});

  try {
    if (job.kind === 'pdf-dedup') {
      const results = [];
      const preferredDir = String(options.outputDir ?? '').trim();
      for (let i = 0; i < job.inputPaths.length; i += 1) {
        if (controller.signal.aborted) throw new Error('작업이 취소되었습니다.');
        const inputPath = job.inputPaths[i];
        const one = await processPdfDedup({
          inputPath,
          outputDir: preferredDir || path.dirname(inputPath),
          mode: options.mode === 'global' ? 'global' : 'consecutive',
          similarityPercent: Number(options.similarityPercent) || 99.99,
          signal: controller.signal,
          onProgress: (ratio) => {
            const base = i / job.inputPaths.length;
            const span = 1 / job.inputPaths.length;
            job.progress = Math.min(0.99, base + ratio * span);
            job.updatedAt = Date.now();
          },
        });
        results.push(one);
        job.logs.push(
          one.unchanged
            ? `${path.basename(inputPath)}: 중복 없음`
            : `${path.basename(inputPath)}: ${one.pagesBefore}→${one.pagesAfter}쪽 (−${one.removedCount})`,
        );
      }
      const changed = results.filter((r) => r.outputPath);
      job.outputPath = changed[0]?.outputPath || '';
      job.result = {
        kind: 'pdf-dedup',
        items: results.map((r) => ({
          inputPath: r.inputPath,
          outputPath: r.outputPath,
          pagesBefore: r.pagesBefore,
          pagesAfter: r.pagesAfter,
          removedCount: r.removedCount,
          unchanged: r.unchanged,
        })),
      };
    } else {
      const logs = [];
      const extracted = await processEbookExtract({
        inputPaths: job.inputPaths,
        outputDir: job.outputPath,
        manualCrop: options.manualCrop ?? null,
        consecutiveImages: Number(options.consecutiveImages) || 5,
        similarityPercent: Number(options.similarityPercent) || 99.9,
        skipBlank: options.skipBlank !== false,
        signal: controller.signal,
        onProgress: (ratio) => {
          job.progress = Math.min(0.99, ratio);
          job.updatedAt = Date.now();
        },
        onLog: (line) => {
          logs.push(line);
          job.logs = logs.slice(-200);
          job.updatedAt = Date.now();
        },
      });
      job.result = {
        kind: 'ebook-extract',
        outputCount: extracted.outputCount,
        duplicateCount: extracted.duplicateCount,
        blankCount: extracted.blankCount,
        pagesDir: extracted.pagesDir,
      };
      job.logs = logs.slice(-200);
    }

    if (controller.signal.aborted) {
      job.state = 'cancelled';
      job.error = '작업이 취소되었습니다.';
    } else {
      job.state = 'done';
      job.progress = 1;
      job.error = '';
    }
  } catch (err) {
    if (controller.signal.aborted) {
      job.state = 'cancelled';
      job.error = '작업이 취소되었습니다.';
    } else {
      job.state = 'error';
      job.error = err instanceof Error ? err.message : String(err);
    }
  } finally {
    job.finishedAt = Date.now();
    job.updatedAt = job.finishedAt;
    controllers.delete(job.id);
  }
}

/**
 * @param {{
 *   kind: 'pdf-dedup' | 'ebook-extract',
 *   inputPaths: string[],
 *   options?: Record<string, unknown>,
 *   outputDir?: string,
 * }} body
 */
export function startCleanupJob(body) {
  const kind = body.kind === 'ebook-extract' ? 'ebook-extract' : 'pdf-dedup';
  const inputPaths = [...new Set((body.inputPaths ?? []).map((p) => path.resolve(String(p ?? '').trim())).filter(Boolean))];
  if (inputPaths.length === 0) throw new Error('입력 파일을 선택해 주세요.');

  for (const p of inputPaths) {
    if (!fs.existsSync(p) || !fs.statSync(p).isFile()) {
      throw new Error(`파일을 찾을 수 없습니다.\n${p}`);
    }
  }

  const id = randomUUID();
  const requestedOut = String(body.outputDir ?? '').trim();

  // eBook extraction writes PNGs into its own folder (default: beside the first
  // image, or inside the chosen output folder): `ebook_<stamp>/output`, `/duplicated`.
  const outputPath =
    kind === 'ebook-extract'
      ? path.join(
          requestedOut ? path.resolve(requestedOut) : path.dirname(inputPaths[0]),
          `ebook_${stamp()}_${id.slice(0, 8)}`,
        )
      : '';

  const now = Date.now();
  /** @type {CleanupJob} */
  const job = {
    id,
    kind,
    label: kind === 'ebook-extract' ? '이북(eBook) 영역 추출' : 'PDF 중복 페이지 제거',
    inputPaths,
    outputPath,
    state: 'queued',
    progress: 0,
    error: '',
    result: {
      options: {
        ...(body.options ?? {}),
        outputDir: requestedOut,
      },
    },
    logs: [],
    createdAt: now,
    updatedAt: now,
    finishedAt: null,
  };
  jobs.set(id, job);
  controllers.set(id, new AbortController());
  waitQueue.push(id);
  pump();
  return publicJob(job);
}

/** @param {string} jobId */
export function getCleanupJob(jobId) {
  const job = jobs.get(String(jobId ?? ''));
  return job ? publicJob(job) : null;
}

/** @param {string} jobId */
export function cancelCleanupJob(jobId) {
  const id = String(jobId ?? '');
  const job = jobs.get(id);
  if (!job) return null;
  const controller = controllers.get(id);
  if (job.state === 'queued' || job.state === 'running') {
    controller?.abort();
    const idx = waitQueue.indexOf(id);
    if (idx >= 0) waitQueue.splice(idx, 1);
    if (job.state === 'queued') {
      job.state = 'cancelled';
      job.error = '작업이 취소되었습니다.';
      job.finishedAt = Date.now();
      job.updatedAt = job.finishedAt;
      controllers.delete(id);
    }
  }
  return publicJob(job);
}
