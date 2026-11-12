/**
 * PDF 용량 줄이기·암호 API.
 */
import fs from 'node:fs';
import path from 'node:path';
import { ApiError, defineApi } from '../api/registry.js';
import {
  OPTIMIZE_DPI_CHOICES,
  compressPdfToDir,
  normalizeCompressOptions,
} from '../pdf/compress.js';
import {
  passwordForPath,
  probePdfPasswords,
  verifyPdfPassword,
} from '../pdf/passwords.js';

function isPdfPath(filePath) {
  return path.extname(filePath).toLowerCase() === '.pdf';
}

export function register() {
  defineApi('pdf.compress.options', () => ({
    dpiChoices: OPTIMIZE_DPI_CHOICES,
    defaults: normalizeCompressOptions({}),
  }));

  defineApi('pdf.passwords.probe', (body) => {
    const paths = Array.isArray(body?.paths) ? body.paths : [];
    return probePdfPasswords(paths.map((item) => String(item ?? '')));
  });

  defineApi('pdf.passwords.verify', (body) => {
    const filePath = String(body?.path ?? '').trim();
    const password = String(body?.password ?? '');
    if (!filePath) throw new ApiError('파일 경로가 없습니다.');
    return verifyPdfPassword(filePath, password);
  });

  defineApi('pdf.compress.run', async (body) => {
    const inputPaths = Array.isArray(body?.inputPaths)
      ? body.inputPaths.map((item) => String(item ?? '').trim()).filter(Boolean)
      : [];
    if (inputPaths.length === 0) throw new ApiError('PDF 파일을 선택하세요.');
    const outputDir = typeof body?.outputDir === 'string' ? body.outputDir.trim() : '';
    const options = normalizeCompressOptions(body?.options);
    const passwords = body?.passwords;

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
        results.push(
          await compressPdfToDir(resolved, outputDir, options, passwordForPath(passwords, resolved)),
        );
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
