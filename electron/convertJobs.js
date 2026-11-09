import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { getConverter } from './converters/registry.js';
import { resolveFfmpegBinary } from './ffmpegService.js';
import { getSettings } from './settingsService.js';

/**
 * @typedef {'queued' | 'running' | 'done' | 'error' | 'cancelled'} JobState
 *
 * @typedef {{
 *   id: string,
 *   batchId: string,
 *   converterId: string,
 *   inputPath: string,
 *   inputPaths: string[],
 *   outputPath: string,
 *   state: JobState,
 *   progress: number,
 *   error: string,
 *   createdAt: number,
 *   updatedAt: number,
 *   finishedAt: number | null,
 * }} ConvertJob
 *
 * @typedef {{
 *   job: ConvertJob,
 *   options: Record<string, unknown>,
 * }} QueuedEntry
 */

/** @type {Map<string, ConvertJob>} */
const jobs = new Map();

/** @type {Map<string, AbortController>} */
const controllers = new Map();

/** @type {QueuedEntry[]} */
const waitQueue = [];

let activeCount = 0;
const MAX_CONCURRENCY = 1;
const MAX_JOBS = 80;
const MAX_BATCH_SIZE = 50;

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** @param {ConvertJob} job */
function publicJob(job) {
  return structuredClone(job);
}

function pruneJobs() {
  if (jobs.size <= MAX_JOBS) return;
  const finished = [...jobs.values()]
    .filter((j) => j.state === 'done' || j.state === 'error' || j.state === 'cancelled')
    .sort((a, b) => (a.finishedAt ?? 0) - (b.finishedAt ?? 0));
  while (jobs.size > MAX_JOBS && finished.length) {
    const old = finished.shift();
    if (!old) break;
    jobs.delete(old.id);
    controllers.delete(old.id);
  }
}

/**
 * @param {unknown} body
 * @returns {string[]}
 */
function collectInputPaths(body) {
  const src = body && typeof body === 'object' ? /** @type {Record<string, unknown>} */ (body) : {};
  /** @type {string[]} */
  const raw = [];
  if (Array.isArray(src.inputPaths)) {
    for (const item of src.inputPaths) raw.push(String(item ?? '').trim());
  }
  if (typeof src.inputPath === 'string' && src.inputPath.trim()) {
    raw.push(src.inputPath.trim());
  }
  const seen = new Set();
  /** @type {string[]} */
  const paths = [];
  for (const item of raw) {
    if (!item) continue;
    const resolved = path.resolve(item);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    paths.push(resolved);
  }
  return paths;
}

/**
 * Ensure a custom output folder exists and return its absolute path.
 * Empty input is invalid here — callers should use source-folder default instead.
 * @param {string} outputDir
 */
export function resolveExportDir(outputDir) {
  const chosen = String(outputDir ?? '').trim();
  if (!chosen) throw new Error('저장 폴더 경로가 비어 있습니다.');
  const dir = path.resolve(chosen);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Snapshot for the convert UI.
 * Empty `exportDir` means default: each video's own folder.
 */
export function getExportDirInfo() {
  const saved = String(getSettings().exportDir ?? '').trim();
  return {
    exportDir: saved,
    /** Empty string = UI should leave the field blank (source-folder default). */
    defaultExportDir: '',
    resolvedExportDir: saved,
    usingDefault: !saved,
    defaultMode: 'source',
    defaultLabel: '각 영상이 있는 폴더',
  };
}

/**
 * @param {import('./converters/registry.js').ConverterDefinition} converter
 * @param {string} inputPath
 * @param {Record<string, unknown>} options
 */
function resolveOutputExt(converter, inputPath, options) {
  if (typeof converter.resolveOutputExt === 'function') {
    const ext = String(converter.resolveOutputExt(inputPath, options) ?? '').trim().toLowerCase();
    if (ext) return ext.startsWith('.') ? ext : `.${ext}`;
  }
  return converter.outputExt;
}

/**
 * Priority: explicit file → explicit/settings outputDir → dirname(input).
 * @param {import('./converters/registry.js').ConverterDefinition} converter
 * @param {string} inputPath
 * @param {{ outputPath?: string, outputDir?: string }} targets
 * @param {string} jobId
 * @param {Record<string, unknown>} [options]
 */
function resolveOutputPath(converter, inputPath, targets, jobId, options = {}, merge = false) {
  const explicitFile = String(targets.outputPath ?? '').trim();
  if (explicitFile) return path.resolve(explicitFile);

  const explicitDir = String(targets.outputDir ?? '').trim();
  const settingsDir = String(getSettings().exportDir ?? '').trim();
  const dir = path.resolve(explicitDir || settingsDir || path.dirname(inputPath));
  fs.mkdirSync(dir, { recursive: true });

  const outputExt = resolveOutputExt(converter, inputPath, options);
  const base = merge
    ? 'merged'
    : path.basename(inputPath, path.extname(inputPath));
  return path.join(dir, `${base}_${stamp()}_${jobId.slice(0, 8)}${outputExt}`);
}

function pumpQueue() {
  while (activeCount < MAX_CONCURRENCY && waitQueue.length > 0) {
    const entry = waitQueue.shift();
    if (!entry) break;
    const { job, options } = entry;
    if (job.state !== 'queued') continue;
    activeCount += 1;
    void runJob(job, options).finally(() => {
      activeCount -= 1;
      pumpQueue();
    });
  }
}

/**
 * @param {ConvertJob} job
 * @param {Record<string, unknown>} options
 */
async function runJob(job, options) {
  const converter = getConverter(job.converterId);
  const controller = controllers.get(job.id);
  if (!converter || !controller) {
    job.state = 'error';
    job.error = '변환기를 초기화하지 못했습니다.';
    job.finishedAt = Date.now();
    job.updatedAt = job.finishedAt;
    return;
  }

  let ffmpegPath;
  try {
    ffmpegPath = resolveFfmpegBinary().path;
  } catch (err) {
    job.state = 'error';
    job.error = err instanceof Error ? err.message : String(err);
    job.finishedAt = Date.now();
    job.updatedAt = job.finishedAt;
    controllers.delete(job.id);
    return;
  }

  job.state = 'running';
  job.updatedAt = Date.now();
  try {
    await converter.run({
      ffmpegPath,
      inputPath: job.inputPath,
      inputPaths: job.inputPaths?.length ? job.inputPaths : [job.inputPath],
      outputPath: job.outputPath,
      options,
      signal: controller.signal,
      onProgress: (ratio) => {
        const next = Math.min(1, Math.max(0, Number(ratio) || 0));
        job.progress = next;
        job.updatedAt = Date.now();
      },
    });
    if (controller.signal.aborted) {
      job.state = 'cancelled';
      job.error = '변환이 취소되었습니다.';
    } else {
      job.state = 'done';
      job.progress = 1;
      job.error = '';
    }
  } catch (err) {
    if (controller.signal.aborted) {
      job.state = 'cancelled';
      job.error = '변환이 취소되었습니다.';
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
 *   converterId: string,
 *   inputPath?: string,
 *   inputPaths?: string[],
 *   outputPath?: string,
 *   outputDir?: string,
 *   options?: Record<string, unknown>,
 * }} body
 */
export function startConvertJobs(body) {
  const converterId = String(body.converterId ?? '').trim();
  const converter = getConverter(converterId);
  if (!converter) throw new Error(`알 수 없는 변환기입니다: ${converterId || '(없음)'}`);

  const inputPaths = collectInputPaths(body);
  if (inputPaths.length === 0) throw new Error('입력 파일을 선택해 주세요.');
  if (inputPaths.length > MAX_BATCH_SIZE) {
    throw new Error(`한 번에 최대 ${MAX_BATCH_SIZE}개까지 변환할 수 있습니다.`);
  }

  const mergeMode = (converter.jobMode ?? 'per-file') === 'merge';
  const minInputs = Math.max(1, Number(converter.minInputs) || 1);
  if (mergeMode && inputPaths.length < minInputs) {
    throw new Error(`이어붙이려면 파일을 최소 ${minInputs}개 선택해 주세요.`);
  }
  if (!mergeMode && body.outputPath && inputPaths.length > 1) {
    throw new Error('여러 파일을 변환할 때는 개별 출력 파일 경로를 지정할 수 없습니다. 저장 폴더(outputDir)를 사용하세요.');
  }

  // Validate all inputs before enqueueing any.
  for (const inputPath of inputPaths) {
    if (!fs.existsSync(inputPath) || !fs.statSync(inputPath).isFile()) {
      throw new Error(`입력 파일을 찾을 수 없습니다.\n${inputPath}`);
    }
    const ext = path.extname(inputPath).toLowerCase();
    if (!converter.inputExts.includes(ext)) {
      throw new Error(
        `지원하지 않는 형식입니다 (${ext || '확장자 없음'}).\n지원: ${converter.inputExts.join(', ')}\n${inputPath}`,
      );
    }
  }

  const options = converter.normalizeOptions(body.options);
  const outputDir = String(body.outputDir ?? '').trim();
  // Custom folder: create early. Empty = per-video source folder (resolved per job).
  if (outputDir) resolveExportDir(outputDir);
  const batchId = randomUUID();
  const now = Date.now();
  /** @type {ConvertJob[]} */
  const created = [];

  /** @param {string[]} paths */
  const enqueueJob = (paths) => {
    const id = randomUUID();
    const primary = paths[0];
    const outputPath = resolveOutputPath(
      converter,
      primary,
      { outputPath: body.outputPath, outputDir },
      id,
      options,
      mergeMode,
    );
    /** @type {ConvertJob} */
    const job = {
      id,
      batchId,
      converterId,
      inputPath: primary,
      inputPaths: [...paths],
      outputPath,
      state: 'queued',
      progress: 0,
      error: '',
      createdAt: now,
      updatedAt: now,
      finishedAt: null,
    };
    jobs.set(id, job);
    controllers.set(id, new AbortController());
    waitQueue.push({ job, options });
    created.push(job);
  };

  if (mergeMode) {
    enqueueJob(inputPaths);
  } else {
    for (const inputPath of inputPaths) {
      enqueueJob([inputPath]);
    }
  }

  pruneJobs();
  pumpQueue();

  return {
    batchId,
    jobs: created.map(publicJob),
  };
}

/**
 * @param {{
 *   converterId: string,
 *   inputPath: string,
 *   outputPath?: string,
 *   options?: Record<string, unknown>,
 * }} body
 */
export function startConvertJob(body) {
  const { jobs: created } = startConvertJobs({
    converterId: body.converterId,
    inputPaths: [body.inputPath],
    outputPath: body.outputPath,
    options: body.options,
  });
  return created[0];
}

/** @param {string} jobId */
export function getConvertJob(jobId) {
  const job = jobs.get(String(jobId ?? ''));
  return job ? publicJob(job) : null;
}

/** @param {string} batchId */
export function getConvertBatch(batchId) {
  const id = String(batchId ?? '');
  const batchJobs = [...jobs.values()]
    .filter((j) => j.batchId === id)
    .sort((a, b) => a.createdAt - b.createdAt || a.inputPath.localeCompare(b.inputPath));
  if (batchJobs.length === 0) return null;

  const total = batchJobs.length;
  const done = batchJobs.filter((j) => j.state === 'done').length;
  const failed = batchJobs.filter((j) => j.state === 'error').length;
  const cancelled = batchJobs.filter((j) => j.state === 'cancelled').length;
  const active = batchJobs.filter((j) => j.state === 'queued' || j.state === 'running').length;
  const progress =
    total === 0
      ? 0
      : batchJobs.reduce((sum, j) => {
          if (j.state === 'done') return sum + 1;
          if (j.state === 'error' || j.state === 'cancelled') return sum + 1;
          return sum + (j.progress || 0);
        }, 0) / total;

  /** @type {JobState} */
  let state = 'running';
  if (active > 0) state = batchJobs.some((j) => j.state === 'running') ? 'running' : 'queued';
  else if (cancelled === total) state = 'cancelled';
  else if (failed > 0 && done + failed + cancelled === total) state = 'error';
  else if (done === total) state = 'done';
  else state = 'done';

  return {
    batchId: id,
    state,
    progress,
    total,
    done,
    failed,
    cancelled,
    active,
    jobs: batchJobs.map(publicJob),
  };
}

/** @param {string} jobId */
export function cancelConvertJob(jobId) {
  const id = String(jobId ?? '');
  const job = jobs.get(id);
  if (!job) return null;
  const controller = controllers.get(id);
  if (job.state === 'queued' || job.state === 'running') {
    controller?.abort();
    // Remove from wait queue if still waiting.
    for (let i = waitQueue.length - 1; i >= 0; i -= 1) {
      if (waitQueue[i].job.id === id) waitQueue.splice(i, 1);
    }
    if (job.state === 'queued') {
      job.state = 'cancelled';
      job.error = '변환이 취소되었습니다.';
      job.finishedAt = Date.now();
      job.updatedAt = job.finishedAt;
      controllers.delete(id);
    }
  }
  return publicJob(job);
}

/** @param {string} batchId */
export function cancelConvertBatch(batchId) {
  const batch = getConvertBatch(batchId);
  if (!batch) return null;
  for (const job of batch.jobs) {
    if (job.state === 'queued' || job.state === 'running') cancelConvertJob(job.id);
  }
  return getConvertBatch(batchId);
}

export function listConvertJobs() {
  return [...jobs.values()]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 40)
    .map(publicJob);
}
