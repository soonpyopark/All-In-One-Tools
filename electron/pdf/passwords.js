/**
 * PDF 암호 검사·인증 (mupdf).
 */
import fs from 'node:fs';
import path from 'node:path';
import * as mupdf from 'mupdf';

/**
 * @param {Buffer | Uint8Array | ArrayBuffer} bytes
 * @param {string} [password]
 * @returns {import('mupdf').PDFDocument}
 */
export function openPdfDocument(bytes, password = '') {
  const opened = mupdf.Document.openDocument(bytes, 'application/pdf');
  if (!(opened instanceof mupdf.PDFDocument) && !opened.isPDF?.()) {
    throw new Error('PDF 파일이 아닙니다.');
  }
  /** @type {import('mupdf').PDFDocument} */
  const pdf = /** @type {any} */ (opened);
  if (typeof pdf.needsPassword === 'function' && pdf.needsPassword()) {
    const ok = pdf.authenticatePassword(String(password ?? ''));
    if (!ok) {
      throw new Error('PDF 비밀번호가 올바르지 않습니다.');
    }
  }
  return pdf;
}

/**
 * 암호를 푼 PDF 바이트(재암호화 없음). 중복 정리 등 pdf-lib 입력용.
 * @param {string} filePath
 * @param {string} [password]
 * @returns {Uint8Array}
 */
export function decryptPdfBytes(filePath, password = '') {
  const source = fs.readFileSync(filePath);
  const pdf = openPdfDocument(source, password);
  const saved = pdf.saveToBuffer('decrypt,compress,garbage');
  if (saved?.asUint8Array) return saved.asUint8Array();
  if (saved instanceof Uint8Array) return saved;
  return new Uint8Array(saved);
}

/**
 * @param {string} filePath
 * @returns {{ locked: boolean, error?: string }}
 */
export function probePdfPassword(filePath) {
  const resolved = path.resolve(String(filePath ?? '').trim());
  if (!resolved || !fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    return { locked: false, error: '파일을 찾을 수 없습니다.' };
  }
  if (path.extname(resolved).toLowerCase() !== '.pdf') {
    return { locked: false };
  }
  try {
    const bytes = fs.readFileSync(resolved);
    const opened = mupdf.Document.openDocument(bytes, 'application/pdf');
    if (!(opened instanceof mupdf.PDFDocument) && !opened.isPDF?.()) {
      return { locked: false, error: 'PDF 파일이 아닙니다.' };
    }
    /** @type {import('mupdf').PDFDocument} */
    const pdf = /** @type {any} */ (opened);
    const locked = typeof pdf.needsPassword === 'function' && pdf.needsPassword();
    return { locked: Boolean(locked) };
  } catch (err) {
    return { locked: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * @param {string[]} paths
 * @returns {{ locked: string[], unlocked: string[], errors: { path: string, error: string }[] }}
 */
export function probePdfPasswords(paths) {
  const list = Array.isArray(paths) ? paths : [];
  /** @type {string[]} */
  const locked = [];
  /** @type {string[]} */
  const unlocked = [];
  /** @type {{ path: string, error: string }[]} */
  const errors = [];
  const seen = new Set();

  for (const raw of list) {
    const resolved = path.resolve(String(raw ?? '').trim());
    if (!resolved || seen.has(resolved.toLowerCase())) continue;
    seen.add(resolved.toLowerCase());
    if (path.extname(resolved).toLowerCase() !== '.pdf') {
      unlocked.push(resolved);
      continue;
    }
    const result = probePdfPassword(resolved);
    if (result.error) {
      errors.push({ path: resolved, error: result.error });
      continue;
    }
    if (result.locked) locked.push(resolved);
    else unlocked.push(resolved);
  }

  return { locked, unlocked, errors };
}

/**
 * @param {string} filePath
 * @param {string} password
 * @returns {{ ok: boolean, error?: string }}
 */
export function verifyPdfPassword(filePath, password) {
  const resolved = path.resolve(String(filePath ?? '').trim());
  if (!resolved || !fs.existsSync(resolved)) {
    return { ok: false, error: '파일을 찾을 수 없습니다.' };
  }
  try {
    openPdfDocument(fs.readFileSync(resolved), String(password ?? ''));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * body.passwords 맵에서 경로에 맞는 암호를 찾습니다.
 * @param {unknown} passwords
 * @param {string} filePath
 * @returns {string}
 */
export function passwordForPath(passwords, filePath) {
  if (!passwords || typeof passwords !== 'object') return '';
  const map = /** @type {Record<string, unknown>} */ (passwords);
  const resolved = path.resolve(String(filePath ?? '').trim());
  const direct = map[resolved] ?? map[filePath];
  if (typeof direct === 'string') return direct;
  const lower = resolved.toLowerCase();
  for (const [key, value] of Object.entries(map)) {
    if (path.resolve(String(key)).toLowerCase() === lower && typeof value === 'string') {
      return value;
    }
  }
  return '';
}
