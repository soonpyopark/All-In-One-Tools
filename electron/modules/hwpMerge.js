/**
 * 한글 파일(HWP/HWPX) 병합 — Windows + 한컴 한글 COM.
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ApiError, defineApi } from '../api/registry.js';
import { hangulAvailability } from '../hwpMerge/findHangul.js';
import {
  isHangulDoc,
  resolveOutputPath,
  runHangulMerge,
  sanitizeMergeName,
} from '../hwpMerge/runMerge.js';

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
 * }} HwpMergeJob
 */

/** @type {Map<string, HwpMergeJob>} */
const jobs = new Map();

/**
 * @param {string[]} raw
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
    if (!isHangulDoc(value)) continue;
    if (!fs.existsSync(value) || !fs.statSync(value).isFile()) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

export function register() {
  if (process.platform !== 'win32') {
    defineApi('hwpMerge.available', () => ({ windows: false, installed: false }));
    defineApi('hwpMerge.resolveOutput', () => {
      throw new ApiError('HWP/HWPX 병합은 Windows에서만 사용할 수 있습니다.');
    });
    defineApi('hwpMerge.run', () => {
      throw new ApiError('HWP/HWPX 병합은 Windows에서만 사용할 수 있습니다.');
    });
    defineApi('hwpMerge.job', () => {
      throw new ApiError('HWP/HWPX 병합은 Windows에서만 사용할 수 있습니다.');
    });
    return;
  }

  defineApi('hwpMerge.available', () => {
    const info = hangulAvailability();
    return { windows: info.windows, installed: info.installed };
  });

  defineApi('hwpMerge.resolveOutput', (body) => {
    const paths = normalizePaths(body?.paths);
    if (paths.length < 1) throw new ApiError('파일을 먼저 추가해 주세요.');
    const outputName = sanitizeMergeName(body?.outputName);
    const outputDir = typeof body?.outputDir === 'string' ? body.outputDir.trim() : '';
    const outputPath = resolveOutputPath(paths, outputDir, outputName);
    return {
      outputPath,
      exists: fs.existsSync(outputPath),
      extension: path.extname(outputPath).toLowerCase(),
    };
  });

  defineApi('hwpMerge.run', async (body) => {
    const info = hangulAvailability();
    if (!info.installed) {
      throw new ApiError(
        '한컴 한글(한컴오피스)이 설치되어 있지 않습니다.\n\nHWP/HWPX를 병합하려면 한컴 한글이 필요합니다.',
      );
    }

    const paths = normalizePaths(body?.paths);
    if (paths.length < 2) {
      throw new ApiError('병합하려면 한글 파일이 2개 이상 필요합니다.');
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
    /** @type {HwpMergeJob} */
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

    void (async () => {
      try {
        const result = await runHangulMerge({
          paths,
          outputPath,
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

  defineApi('hwpMerge.job', (body) => {
    const id = String(body?.id ?? '').trim();
    const job = jobs.get(id);
    if (!job) throw new ApiError('작업을 찾을 수 없습니다.');
    return { ...job };
  });
}
