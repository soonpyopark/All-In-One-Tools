/**
 * PDF·이미지 페이지를 렌더 → OCR → 보이지 않는 글자 층으로 붙입니다.
 * 이미지는 먼저 1쪽 PDF 로 만든 뒤 OCR 합니다.
 * Tiny PDF Editor(`pdf_editor/ocr.py`)와 같은 목적(검색 가능한 PDF)입니다.
 */
import fs from 'node:fs';
import path from 'node:path';
import * as mupdf from 'mupdf';
import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';
import { isOcrImagePath, isOcrInputPath } from '../../shared/ocrInputs.js';
import { resolveOcrModelIds } from '../../shared/ocrLanguages.js';
import { getOcrEngine } from './engine.js';

export const OCR_DPI = 180;
const SKIP_NATIVE_TEXT_CHARS = 20;
/** 이미지→PDF 변환 시 긴 변 최대(pt). */
const IMAGE_PDF_MAX_EDGE = 1600;

/**
 * @param {string} text
 */
function escapePdfLiteral(text) {
  return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

/**
 * CJK 글자용 UTF-16BE 헥스(BOM 포함).
 * @param {string} text
 */
function utf16beHex(text) {
  let hex = 'FEFF';
  for (const ch of text) {
    const code = ch.codePointAt(0);
    if (code > 0xffff) {
      const v = code - 0x10000;
      const a = 0xd800 + (v >> 10);
      const b = 0xdc00 + (v & 0x3ff);
      hex += a.toString(16).padStart(4, '0') + b.toString(16).padStart(4, '0');
    } else {
      hex += code.toString(16).padStart(4, '0');
    }
  }
  return hex;
}

/**
 * @param {string} text
 */
function needsCjk(text) {
  return /[^\u0000-\u00ff]/.test(text);
}

/** @param {mupdf.PDFPage} page */
function pageTextLength(page) {
  try {
    return (page.toStructuredText().asText() || '').replace(/\s+/g, '').length;
  } catch {
    return 0;
  }
}

/**
 * 이미지 파일을 1쪽 PDF 바이트로 만듭니다. (긴 변 IMAGE_PDF_MAX_EDGE pt)
 * @param {string} imagePath
 */
async function imageToPdfBytes(imagePath) {
  const meta = await sharp(imagePath).rotate().metadata();
  const srcW = Number(meta.width) || 0;
  const srcH = Number(meta.height) || 0;
  if (srcW < 1 || srcH < 1) throw new Error(`이미지 크기를 읽지 못했습니다.\n${imagePath}`);

  const scale = Math.min(1, IMAGE_PDF_MAX_EDGE / Math.max(srcW, srcH));
  const width = Math.max(1, Math.round(srcW * scale));
  const height = Math.max(1, Math.round(srcH * scale));

  const jpeg = await sharp(imagePath)
    .rotate()
    .resize(width, height, { fit: 'fill' })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 92, chromaSubsampling: '4:4:4' })
    .toBuffer();

  const doc = await PDFDocument.create();
  const embedded = await doc.embedJpg(jpeg);
  const page = doc.addPage([width, height]);
  page.drawImage(embedded, { x: 0, y: 0, width, height });
  return Buffer.from(await doc.save());
}

/**
 * @param {mupdf.PDFDocument} doc
 * @param {mupdf.PDFPage} page
 * @param {import('./engine.js').OcrLine[]} lines
 * @param {number} zoom
 */
function appendInvisibleText(doc, page, lines, zoom) {
  if (lines.length === 0) return 0;
  const pageObj = page.getObject();
  let resources = pageObj.get('Resources');
  if (!resources.isDictionary()) {
    resources = doc.newDictionary();
    pageObj.put('Resources', resources);
  }
  let fonts = resources.get('Font');
  if (!fonts.isDictionary()) {
    fonts = doc.newDictionary();
    resources.put('Font', fonts);
  }
  if (fonts.get('OCRHelv').isNull()) {
    fonts.put('OCRHelv', doc.addSimpleFont(new mupdf.Font('Helvetica')));
  }
  if (fonts.get('OCRKo').isNull()) {
    fonts.put('OCRKo', doc.addCJKFont(new mupdf.Font('ko'), 'ko'));
  }

  const bounds = page.getBounds();
  const pageH = bounds[3] - bounds[1];
  const parts = ['BT', '3 Tr'];
  let written = 0;
  for (const line of lines) {
    const text = (line.text || '').trim();
    if (!text) continue;
    const box = {
      x0: line.x / zoom,
      y0: line.y / zoom,
      x1: (line.x + line.w) / zoom,
      y1: (line.y + line.h) / zoom,
    };
    const boxH = Math.max(1, box.y1 - box.y0);
    let size = Math.max(4, Math.min(72, boxH * 0.82));
    // PDF 좌표계는 왼쪽 아래가 원점
    const pdfX = bounds[0] + box.x0;
    const pdfY = bounds[1] + (pageH - box.y1) + Math.min(boxH * 0.15, 2);
    if (needsCjk(text)) {
      parts.push(`/OCRKo ${size.toFixed(2)} Tf`);
      parts.push(`1 0 0 1 ${pdfX.toFixed(2)} ${pdfY.toFixed(2)} Tm`);
      parts.push(`<${utf16beHex(text)}> Tj`);
    } else {
      parts.push(`/OCRHelv ${size.toFixed(2)} Tf`);
      parts.push(`1 0 0 1 ${pdfX.toFixed(2)} ${pdfY.toFixed(2)} Tm`);
      parts.push(`(${escapePdfLiteral(text)}) Tj`);
    }
    written += 1;
  }
  parts.push('ET');
  const buf = new mupdf.Buffer();
  buf.write(`${parts.join('\n')}\n`);
  const stream = doc.addStream(buf, {});

  const contents = pageObj.get('Contents');
  if (contents.isArray()) {
    contents.push(stream);
  } else if (contents.isNull()) {
    pageObj.put('Contents', stream);
  } else {
    const arr = doc.newArray();
    arr.push(contents);
    arr.push(stream);
    pageObj.put('Contents', arr);
  }
  return written;
}

/**
 * @param {{
 *   inputPath: string,
 *   outputDir?: string,
 *   languages?: string[],
 *   skipNativeText?: boolean,
 *   signal?: AbortSignal,
 *   onProgress?: (ratio: number) => void,
 *   onLog?: (line: string) => void,
 * }} options
 */
export async function processPdfOcr(options) {
  const inputPath = path.resolve(String(options.inputPath ?? ''));
  if (!fs.existsSync(inputPath) || !fs.statSync(inputPath).isFile()) {
    throw new Error(`파일을 찾을 수 없습니다.\n${inputPath}`);
  }
  if (!isOcrInputPath(inputPath)) {
    throw new Error(`지원하지 않는 형식입니다.\n${inputPath}`);
  }

  const fromImage = isOcrImagePath(inputPath);
  // 이미지는 방금 만든 PDF 라 글자가 없으므로 건너뛰기 검사를 하지 않습니다.
  const skipNativeText = fromImage ? false : options.skipNativeText !== false;
  const modelIds = resolveOcrModelIds(options.languages ?? ['korean', 'english']);
  const preferredDir = String(options.outputDir ?? '').trim();
  const outDir = preferredDir ? path.resolve(preferredDir) : path.dirname(inputPath);
  fs.mkdirSync(outDir, { recursive: true });

  const base = path.basename(inputPath, path.extname(inputPath));
  const outputPath = path.join(outDir, `${base}_ocr.pdf`);

  options.onLog?.('OCR 엔진을 준비합니다…');
  const engine = await getOcrEngine(modelIds, options.onLog);

  let bytes;
  if (fromImage) {
    options.onLog?.('이미지를 PDF 로 변환합니다…');
    bytes = await imageToPdfBytes(inputPath);
  } else {
    bytes = fs.readFileSync(inputPath);
  }

  const doc = mupdf.Document.openDocument(bytes, 'application/pdf');
  if (!(doc instanceof mupdf.PDFDocument) && !doc.isPDF?.()) {
    throw new Error('PDF 문서가 아닙니다.');
  }
  /** @type {mupdf.PDFDocument} */
  const pdf = /** @type {any} */ (doc);

  const pageCount = pdf.countPages();
  const zoom = OCR_DPI / 72;
  let applied = 0;
  let skipped = 0;
  let failed = 0;
  let lines = 0;

  for (let i = 0; i < pageCount; i += 1) {
    if (options.signal?.aborted) throw new Error('작업이 취소되었습니다.');
    options.onProgress?.(i / Math.max(pageCount, 1));
    options.onLog?.(`OCR 중… ${i + 1}/${pageCount}쪽`);

    const page = pdf.loadPage(i);
    if (skipNativeText && pageTextLength(page) >= SKIP_NATIVE_TEXT_CHARS) {
      skipped += 1;
      continue;
    }

    try {
      const pix = page.toPixmap(mupdf.Matrix.scale(zoom, zoom), mupdf.ColorSpace.DeviceRGB, false, true);
      const width = pix.getWidth();
      const height = pix.getHeight();
      const rgb = pix.getPixels();
      const recognized = await engine.recognizePage(rgb, width, height);
      const written = appendInvisibleText(pdf, page, recognized, zoom);
      if (written > 0) {
        applied += 1;
        lines += written;
      } else {
        failed += 1;
      }
    } catch (err) {
      failed += 1;
      options.onLog?.(
        `${i + 1}쪽 실패: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  if (options.signal?.aborted) throw new Error('작업이 취소되었습니다.');

  if (applied === 0 && skipped === pageCount) {
    options.onLog?.('이미 글자가 있는 페이지만 있어 OCR 을 건너뛰었습니다.');
  }

  const saved = pdf.saveToBuffer('compress,garbage,pretty');
  fs.writeFileSync(outputPath, saved.asUint8Array());
  options.onProgress?.(1);

  return {
    inputPath,
    outputPath,
    pageCount,
    applied,
    skipped,
    failed,
    lines,
    fromImage,
  };
}
