import fs from 'node:fs';
import path from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import { PDFDocument } from 'pdf-lib';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pdfjsRoot = path.resolve(__dirname, '../../node_modules/pdfjs-dist');
const workerPath = path.join(pdfjsRoot, 'legacy/build/pdf.worker.mjs');
const standardFontDataUrl = pathToFileURL(path.join(pdfjsRoot, 'standard_fonts') + path.sep).href;
GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href;

export const DEFAULT_SIMILARITY_PERCENT = 99.99;

/**
 * @param {unknown} percent
 */
export function percentToThreshold(percent) {
  const n = Number(percent);
  if (!Number.isFinite(n)) return DEFAULT_SIMILARITY_PERCENT / 100;
  if (n > 1) return Math.min(1, Math.max(0, n / 100));
  return Math.min(1, Math.max(0, n));
}

/**
 * @param {string} a
 * @param {string} b
 */
function textSimilarity(a, b) {
  if (a === b) return 1;
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  // Dice coefficient on bigrams — close enough to SequenceMatcher for near-duplicates.
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (let i = 0; i < a.length - 1; i += 1) {
    const bg = a.slice(i, i + 2);
    counts.set(bg, (counts.get(bg) || 0) + 1);
  }
  let overlap = 0;
  for (let i = 0; i < b.length - 1; i += 1) {
    const bg = b.slice(i, i + 2);
    const c = counts.get(bg) || 0;
    if (c > 0) {
      overlap += 1;
      counts.set(bg, c - 1);
    }
  }
  return (2 * overlap) / (a.length - 1 + (b.length - 1));
}

/**
 * @param {Uint8ClampedArray} left
 * @param {Uint8ClampedArray} right
 */
function visualSimilarity(left, right) {
  if (left.length !== right.length) return 0;
  if (left.length === 0) return 1;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff += Math.abs(left[i] - right[i]);
  return 1 - diff / (255 * left.length);
}

/**
 * @param {{ text: string, samples: Uint8ClampedArray }} left
 * @param {{ text: string, samples: Uint8ClampedArray }} right
 */
function pageSimilarity(left, right) {
  const visual = visualSimilarity(left.samples, right.samples);
  if (!left.text && !right.text) return visual;
  if (left.text && right.text) {
    return 0.3 * textSimilarity(left.text, right.text) + 0.7 * visual;
  }
  return Math.min(textSimilarity(left.text, right.text), visual);
}

/**
 * @param {import('pdfjs-dist').PDFDocumentProxy} pdf
 * @param {number} pageIndex 0-based
 * @param {number} compareWidth
 */
async function pageSignature(pdf, pageIndex, compareWidth) {
  const page = await pdf.getPage(pageIndex + 1);
  const textContent = await page.getTextContent();
  const text = textContent.items
    .map((item) => ('str' in item ? String(item.str) : ''))
    .join(' ')
    .trim();

  const viewport0 = page.getViewport({ scale: 1 });
  const scale = compareWidth / viewport0.width;
  const viewport = page.getViewport({ scale });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const context = canvas.getContext('2d');
  await page.render({
    canvasContext: /** @type {any} */ (context),
    viewport,
    canvas,
  }).promise;
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  // RGB only (drop alpha) for fair comparison with PyMuPDF pixmap samples.
  const samples = new Uint8ClampedArray((image.data.length / 4) * 3);
  for (let i = 0, j = 0; i < image.data.length; i += 4, j += 3) {
    samples[j] = image.data[i];
    samples[j + 1] = image.data[i + 1];
    samples[j + 2] = image.data[i + 2];
  }
  return { text, samples };
}

/**
 * @param {import('pdfjs-dist').PDFDocumentProxy} pdf
 * @param {'consecutive' | 'global'} mode
 * @param {number} threshold
 * @param {number} compareWidth
 * @param {(ratio: number) => void} [onProgress]
 */
async function pagesToRemove(pdf, mode, threshold, compareWidth, onProgress) {
  const n = pdf.numPages;
  if (n <= 1) return [];

  /** @type {{ text: string, samples: Uint8ClampedArray }[]} */
  const signatures = [];
  for (let i = 0; i < n; i += 1) {
    signatures.push(await pageSignature(pdf, i, compareWidth));
    onProgress?.(0.05 + (0.7 * (i + 1)) / n);
  }

  /** @type {number[]} */
  const toRemove = [];
  if (mode === 'consecutive') {
    let reference = signatures[0];
    for (let i = 1; i < n; i += 1) {
      if (pageSimilarity(signatures[i], reference) >= threshold) toRemove.push(i);
      else reference = signatures[i];
    }
  } else {
    /** @type {typeof signatures} */
    const seen = [signatures[0]];
    for (let i = 1; i < n; i += 1) {
      if (seen.some((kept) => pageSimilarity(signatures[i], kept) >= threshold)) {
        toRemove.push(i);
      } else {
        seen.push(signatures[i]);
      }
    }
  }
  return toRemove;
}

function stampMinute() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${String(d.getFullYear()).slice(2)}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

/**
 * @param {string} sourcePath
 * @param {string} outputDir
 */
function uniqueOutputPath(sourcePath, outputDir) {
  const stem = path.basename(sourcePath, path.extname(sourcePath));
  const stamp = stampMinute();
  let dest = path.join(outputDir, `${stem}_${stamp}.pdf`);
  if (!fs.existsSync(dest)) return dest;
  for (let n = 1; n < 1000; n += 1) {
    dest = path.join(outputDir, `${stem}_${stamp}_${n}.pdf`);
    if (!fs.existsSync(dest)) return dest;
  }
  throw new Error('사용 가능한 새 파일 이름을 만들 수 없습니다.');
}

/**
 * @param {{
 *   inputPath: string,
 *   outputDir?: string,
 *   mode?: 'consecutive' | 'global',
 *   similarityPercent?: number,
 *   signal?: AbortSignal,
 *   onProgress?: (ratio: number) => void,
 * }} args
 */
export async function processPdfDedup(args) {
  const inputPath = path.resolve(String(args.inputPath ?? '').trim());
  if (!inputPath || !fs.existsSync(inputPath)) {
    throw new Error(`PDF 파일을 찾을 수 없습니다.\n${inputPath}`);
  }
  if (path.extname(inputPath).toLowerCase() !== '.pdf') {
    throw new Error('PDF 파일만 처리할 수 있습니다.');
  }

  const mode = args.mode === 'global' ? 'global' : 'consecutive';
  const threshold = percentToThreshold(args.similarityPercent ?? DEFAULT_SIMILARITY_PERCENT);
  const outputDir = path.resolve(
    String(args.outputDir ?? '').trim() || path.dirname(inputPath),
  );
  fs.mkdirSync(outputDir, { recursive: true });

  args.onProgress?.(0.02);
  const fileBytes = fs.readFileSync(inputPath);
  const loadingTask = getDocument({
    data: new Uint8Array(fileBytes),
    standardFontDataUrl,
    disableFontFace: true,
    useSystemFonts: true,
  });
  const pdf = await loadingTask.promise;
  try {
    if (args.signal?.aborted) throw new Error('작업이 취소되었습니다.');
    const pagesBefore = pdf.numPages;
    const remove = await pagesToRemove(pdf, mode, threshold, 400, args.onProgress);
    args.onProgress?.(0.8);

    if (remove.length === 0) {
      args.onProgress?.(1);
      return {
        inputPath,
        outputPath: null,
        pagesBefore,
        pagesAfter: pagesBefore,
        removedCount: 0,
        removedIndices: [],
        unchanged: true,
      };
    }

    const keep = [];
    const removeSet = new Set(remove);
    for (let i = 0; i < pagesBefore; i += 1) {
      if (!removeSet.has(i)) keep.push(i);
    }

    // Re-read: pdf.js may detach/transfer the previous Uint8Array.
    const srcDoc = await PDFDocument.load(fs.readFileSync(inputPath), { ignoreEncryption: true });
    const outDoc = await PDFDocument.create();
    const copied = await outDoc.copyPages(srcDoc, keep);
    for (const page of copied) outDoc.addPage(page);
    const bytes = await outDoc.save();
    const outputPath = uniqueOutputPath(inputPath, outputDir);
    fs.writeFileSync(outputPath, bytes);
    args.onProgress?.(1);

    return {
      inputPath,
      outputPath,
      pagesBefore,
      pagesAfter: keep.length,
      removedCount: remove.length,
      removedIndices: remove,
      unchanged: false,
    };
  } finally {
    try {
      if (typeof pdf.cleanup === 'function') await pdf.cleanup();
    } catch {
      // ignore cleanup errors
    }
  }
}
