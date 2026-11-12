import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { isOcrInputPath } from '../../shared/ocrInputs.js';
import { passwordForPath } from '../pdf/passwords.js';
import { processPdfOcr } from './pdfOcr.js';

/**
 * @typedef {'queued' | 'running' | 'done' | 'error' | 'cancelled'} JobState
 *
 * @typedef {{
 *   id: string,
 *   label: string,
 *   inputPaths: string[],
 *   outputDir: string,
 *   state: JobState,
 *   progress: number,
 *   error: string,
 *   result: Record<string, unknown> | null,
 *   logs: string[],
 *   createdAt: number,
 *   updatedAt: number,
 *   finishedAt: number | null,
 * }} OcrJob
 */

/** @type {Map<string, OcrJob>} */
const jobs = new Map();
/** @type {Map<string, AbortController>} */
const controllers = new Map();
/** @type {string[]} */
const waitQueue = [];
let active = false;

/** @param {OcrJob} job */
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

/** @param {OcrJob} job */
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
  const passwords = options.passwords;
  const logs = [];

  try {
    const results = [];
    for (let i = 0; i < job.inputPaths.length; i += 1) {
      if (controller.signal.aborted) throw new Error('작업이 취소되었습니다.');
      const inputPath = job.inputPaths[i];
      logs.push(`—— ${path.basename(inputPath)} ——`);
      job.logs = logs.slice(-300);
      job.updatedAt = Date.now();

      const one = await processPdfOcr({
        inputPath,
        outputDir: job.outputDir || undefined,
        languages: Array.isArray(options.languages) ? options.languages.map(String) : ['korean', 'english'],
        skipNativeText: options.skipNativeText !== false,
        password: passwordForPath(passwords, inputPath),
        signal: controller.signal,
        onProgress: (ratio) => {
          const base = i / job.inputPaths.length;
          const span = 1 / job.inputPaths.length;
          job.progress = Math.min(0.99, base + ratio * span);
          job.updatedAt = Date.now();
        },
        onLog: (line) => {
          logs.push(line);
          job.logs = logs.slice(-300);
          job.updatedAt = Date.now();
        },
      });
      results.push(one);
      logs.push(
        `완료: ${one.applied}쪽 OCR · 건너뜀 ${one.skipped} · 실패 ${one.failed} · 줄 ${one.lines}`,
      );
      logs.push(`저장: ${one.outputPath}`);
      job.logs = logs.slice(-300);
    }

    job.result = {
      ...(job.result || {}),
      items: results,
    };
    job.progress = 1;
    job.state = controller.signal.aborted ? 'cancelled' : 'done';
    if (controller.signal.aborted) job.error = '작업이 취소되었습니다.';
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
 *   inputPaths: string[],
 *   outputDir?: string,
 *   options?: Record<string, unknown>,
 * }} body
 */
export function startOcrJob(body) {
  const inputPaths = [
    ...new Set((body.inputPaths ?? []).map((p) => path.resolve(String(p ?? '').trim())).filter(Boolean)),
  ];
  if (inputPaths.length === 0) throw new Error('PDF 또는 이미지 파일을 선택해 주세요.');
  for (const p of inputPaths) {
    if (!fs.existsSync(p) || !fs.statSync(p).isFile()) {
      throw new Error(`파일을 찾을 수 없습니다.\n${p}`);
    }
    if (!isOcrInputPath(p)) {
      throw new Error(`지원하지 않는 형식입니다.\n${p}`);
    }
  }

  const outputDir = String(body.outputDir ?? '').trim();
  const id = randomUUID();
  const now = Date.now();
  /** @type {OcrJob} */
  const job = {
    id,
    label: 'OCR 변환(PDF & 이미지)',
    inputPaths,
    outputDir,
    state: 'queued',
    progress: 0,
    error: '',
    result: { options: { ...(body.options ?? {}) } },
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
export function getOcrJob(jobId) {
  const job = jobs.get(String(jobId ?? ''));
  return job ? publicJob(job) : null;
}

/** @param {string} jobId */
export function cancelOcrJob(jobId) {
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
