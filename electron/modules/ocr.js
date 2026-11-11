import fs from 'node:fs';
import path from 'node:path';
import { ApiError, defineApi } from '../api/registry.js';
import { cancelOcrJob, getOcrJob, startOcrJob } from '../ocr/jobs.js';
import { coreModelsReady, missingModels, modelsDir } from '../ocr/models.js';
import { OCR_INPUT_EXTS, isOcrInputPath } from '../../shared/ocrInputs.js';
import { resolveOcrModelIds, OCR_LANGUAGE_OPTIONS, DEFAULT_OCR_LANGUAGE_IDS } from '../../shared/ocrLanguages.js';

const MAX_FILES = 20000;
const ALLOWED = new Set(OCR_INPUT_EXTS);

/**
 * @param {string} dir
 * @param {boolean} recursive
 * @param {string[]} out
 * @param {{ truncated: boolean }} state
 */
function collectInputs(dir, recursive, out, state) {
  if (out.length >= MAX_FILES) {
    state.truncated = true;
    return;
  }
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  const collator = new Intl.Collator('ko', { numeric: true, sensitivity: 'base' });
  entries.sort((a, b) => collator.compare(a.name, b.name));
  for (const entry of entries) {
    if (out.length >= MAX_FILES) {
      state.truncated = true;
      return;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (recursive) collectInputs(full, true, out, state);
      continue;
    }
    if (entry.isFile() && ALLOWED.has(path.extname(entry.name).toLowerCase())) {
      out.push(full);
    }
  }
}

export function register() {
  defineApi('ocr.info', () => ({
    languages: OCR_LANGUAGE_OPTIONS,
    defaultLanguages: DEFAULT_OCR_LANGUAGE_IDS,
    inputExts: OCR_INPUT_EXTS,
    modelsDir: modelsDir(),
    coreReady: coreModelsReady(),
  }));

  defineApi('ocr.modelsStatus', (body) => {
    const modelIds = resolveOcrModelIds(Array.isArray(body?.languages) ? body.languages.map(String) : DEFAULT_OCR_LANGUAGE_IDS);
    const folder = modelsDir();
    return {
      modelsDir: folder,
      coreReady: coreModelsReady(folder),
      modelIds,
      missing: missingModels(modelIds, folder),
    };
  });

  /** 파일·폴더 경로를 PDF·이미지 목록으로 펼칩니다. */
  defineApi('ocr.inspect', (body) => {
    const paths = Array.isArray(body?.paths) ? body.paths : [];
    const recursive = body?.recursive === true;
    const files = [];
    let skipped = 0;
    const state = { truncated: false };
    for (const raw of paths) {
      const target = path.resolve(String(raw));
      try {
        const stat = fs.statSync(target);
        if (stat.isDirectory()) {
          const found = [];
          collectInputs(target, recursive, found, state);
          files.push(...found);
        } else if (stat.isFile() && isOcrInputPath(target)) {
          files.push(target);
        } else {
          skipped += 1;
        }
      } catch {
        skipped += 1;
      }
    }
    const unique = [...new Set(files)];
    return {
      files: unique.map((filePath) => ({
        path: filePath,
        name: path.basename(filePath),
        dir: path.dirname(filePath),
        size: fs.statSync(filePath).size,
      })),
      skipped,
      truncated: state.truncated,
    };
  });

  defineApi('ocr.start', (body) => {
    try {
      return { job: startOcrJob(body ?? {}) };
    } catch (err) {
      throw new ApiError(err instanceof Error ? err.message : 'OCR 을 시작하지 못했습니다.');
    }
  });

  defineApi('ocr.status', (body) => {
    const job = getOcrJob(body?.jobId);
    if (!job) throw new ApiError('작업을 찾을 수 없습니다.', 404);
    return { job };
  });

  defineApi('ocr.cancel', (body) => {
    const job = cancelOcrJob(body?.jobId);
    if (!job) throw new ApiError('작업을 찾을 수 없습니다.', 404);
    return { job };
  });
}
