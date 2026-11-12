/**
 * PDF 용량 줄이기 API.
 */
import fs from 'node:fs';
import path from 'node:path';
import { ApiError, defineApi } from '../api/registry.js';
import {
  OPTIMIZE_DPI_CHOICES,
  compressPdfToDir,
  normalizeCompressOptions,
} from '../pdf/compress.js';

function isPdfPath(filePath) {
  return path.extname(filePath).toLowerCase() === '.pdf';
}

export function register() {
  defineApi('pdf.compress.options', () => ({
    dpiChoices: OPTIMIZE_DPI_CHOICES,
    defaults: normalizeCompressOptions({}),
  }));

  defineApi('pdf.compress.run', async (body) => {
    const inputPaths = Array.isArray(body?.inputPaths)
      ? body.inputPaths.map((item) => String(item ?? '').trim()).filter(Boolean)
      : [];
    if (inputPaths.length === 0) throw new ApiError('PDF 파일을 선택하세요.');
    const outputDir = typeof body?.outputDir === 'string' ? body.outputDir.trim() : '';
    const options = normalizeCompressOptions(body?.options);

    /** @type {Awaited<ReturnType<typeof compressPdfToDir>>[]} */
    const results = [];
    /** @type {{ inputPath: string, error: string }[]} */
    const errors = [];

    for (const inputPath of inputPaths) {
      const resolved = path.resolve(inputPath);
      if (!fs.existsSync(resolved) || !isPdfPath(resolved)) {
        errors.push({ inputPath: resolved, error: 'PDF 파일이 아닙니다.' });
        continue;
      }
      try {
        results.push(await compressPdfToDir(resolved, outputDir, options));
      } catch (err) {
        errors.push({
          inputPath: resolved,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return {
      ok: errors.length === 0,
      results,
      errors,
      options,
    };
  });
}
