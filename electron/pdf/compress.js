/**
 * Tiny PDF Editor 용량 줄이기 알고리즘을 mupdf + sharp 로 이식.
 * 텍스트·레이아웃은 유지하고 임베드 이미지만 DPI/품질/사이즈로 재압축합니다.
 */
import fs from 'node:fs';
import path from 'node:path';
import * as mupdf from 'mupdf';
import sharp from 'sharp';
import { openPdfDocument } from './passwords.js';

export const OPTIMIZE_DPI_CHOICES = [36, 48, 72, 96, 120, 150, 200, 300, 400, 600];
const OPTIMIZE_DEFAULT_JPEG_QUALITY = 25;
const OPTIMIZE_PRESERVE_FLATE_MAX_BYTES = 4096;
const MIN_IMAGE_DPI = 24;
const MIN_RESAMPLE_EDGE_PX = 3;

/**
 * @param {number} qualityPercent
 */
export function optimizeJpegQuality(qualityPercent) {
  const pct = Math.max(1, Math.min(100, Math.round(Number(qualityPercent) || 100)));
  return Math.max(5, Math.min(95, Math.round((OPTIMIZE_DEFAULT_JPEG_QUALITY * pct) / 100)));
}

/**
 * @param {unknown} options
 */
export function normalizeCompressOptions(options) {
  const src = options && typeof options === 'object' ? /** @type {Record<string, unknown>} */ (options) : {};
  let dpi = Number(src.imageDpi ?? src.dpi ?? 150);
  if (!Number.isFinite(dpi)) dpi = 150;
  dpi = Math.max(MIN_IMAGE_DPI, Math.min(600, Math.round(dpi)));
  if (!OPTIMIZE_DPI_CHOICES.includes(dpi)) {
    dpi = OPTIMIZE_DPI_CHOICES.reduce((best, value) =>
      Math.abs(value - dpi) < Math.abs(best - dpi) ? value : best,
    );
  }
  let qualityPercent = Number(src.imageQualityPercent ?? src.qualityPercent ?? 100);
  if (!Number.isFinite(qualityPercent)) qualityPercent = 100;
  qualityPercent = Math.max(1, Math.min(100, Math.round(qualityPercent)));
  let sizePercent = Number(src.imageSizePercent ?? src.sizePercent ?? 100);
  if (!Number.isFinite(sizePercent)) sizePercent = 100;
  sizePercent = Math.max(1, Math.min(100, Math.round(sizePercent)));
  return { imageDpi: dpi, imageQualityPercent: qualityPercent, imageSizePercent: sizePercent };
}

/**
 * @param {import('mupdf').PDFObject} obj
 */
function subtypeName(obj) {
  try {
    const value = obj.get('Subtype');
    if (!value || value.isNull?.()) return '';
    if (value.asName) return String(value.asName());
    return String(value).replace(/^\//, '');
  } catch {
    return '';
  }
}

/**
 * @param {import('mupdf').PDFObject} obj
 */
function isTruthyPdfBool(obj) {
  try {
    if (!obj || obj.isNull?.()) return false;
    if (obj.asBoolean) return Boolean(obj.asBoolean());
    const text = String(obj).toLowerCase();
    return text === 'true' || text === '/true';
  } catch {
    return false;
  }
}

/**
 * @param {import('mupdf').PDFObject} obj
 */
function filterText(obj) {
  try {
    const value = obj.get('Filter');
    return value ? String(value) : '';
  } catch {
    return '';
  }
}

/**
 * @param {import('mupdf').PDFObject} obj
 */
function hasImageMaskRef(obj) {
  try {
    for (const key of ['SMask', 'Mask']) {
      const value = obj.get(key);
      if (!value || value.isNull?.()) continue;
      if (value.isIndirect?.() || value.isStream?.() || value.isDictionary?.()) return true;
      const text = String(value);
      if (/^\d+\s+\d+\s+R$/.test(text.trim())) return true;
    }
  } catch {
    // ignore
  }
  return false;
}

/**
 * @param {import('mupdf').PDFObject | null | undefined} dict
 * @param {(obj: import('mupdf').PDFObject) => void} visit
 * @param {Set<number>} seen
 */
function walkImageObjects(dict, visit, seen) {
  if (!dict || !dict.isDictionary?.()) return;
  dict.forEach((value) => {
    try {
      if (!value) return;
      // writeRawStream 은 간접 참조 객체에 해야 문서에 반영됩니다.
      const num = value.asIndirect?.() ?? 0;
      if (num > 0) {
        if (seen.has(num)) return;
        seen.add(num);
      }
      const resolved = value.resolve?.() ?? value;
      const subtype = subtypeName(resolved);
      if (subtype === 'Image') {
        visit(value);
        return;
      }
      if (subtype === 'Form') {
        const res = resolved.get('Resources');
        const xobj = res?.get?.('XObject');
        walkImageObjects(xobj, visit, seen);
      }
    } catch {
      // 개별 객체 실패는 건너뜀
    }
  });
}

/**
 * @param {import('mupdf').PDFDocument} pdf
 * @param {import('mupdf').PDFObject} obj
 * @param {{
 *   targetDpi: number,
 *   jpegQuality: number,
 *   sizePercent: number,
 *   pageWidthPt: number,
 *   pageHeightPt: number,
 * }} opts
 */
async function recompressOneImage(pdf, obj, opts) {
  if (isTruthyPdfBool(obj.get('ImageMask'))) return false;
  if (hasImageMaskRef(obj)) return false;

  let raw;
  try {
    raw = obj.readRawStream();
  } catch {
    return false;
  }
  const oldSize = raw?.byteLength ?? raw?.length ?? 0;
  const flt = filterText(obj);
  if (
    oldSize > 0 &&
    oldSize <= OPTIMIZE_PRESERVE_FLATE_MAX_BYTES &&
    flt.includes('FlateDecode')
  ) {
    return false;
  }

  let image;
  try {
    image = pdf.loadImage(obj);
  } catch {
    return false;
  }

  const width = image.getWidth();
  const height = image.getHeight();
  if (width < MIN_RESAMPLE_EDGE_PX || height < MIN_RESAMPLE_EDGE_PX) return false;

  const sizeScale = Math.max(1, Math.min(100, opts.sizePercent)) / 100;
  // Tiny: display_rect 기준으로 target = pt * dpi / 72.
  // 표시 사각형 API 가 없어, 페이지 박스 크기를 상한으로 씁니다(전면 스캔·사진에 효과적).
  const pageW = Math.max(1, opts.pageWidthPt);
  const pageH = Math.max(1, opts.pageHeightPt);
  let targetW = Math.max(1, Math.round((pageW * opts.targetDpi) / 72) * sizeScale);
  let targetH = Math.max(1, Math.round((pageH * opts.targetDpi) / 72) * sizeScale);
  // 원본보다 키우지 않음
  targetW = Math.min(width, Math.max(1, Math.round(targetW)));
  targetH = Math.min(height, Math.max(1, Math.round(targetH)));
  // 비율 유지하며 페이지 상한 안에 맞춤
  const fit = Math.min(targetW / width, targetH / height, 1);
  targetW = Math.max(1, Math.round(width * fit));
  targetH = Math.max(1, Math.round(height * fit));

  if (Math.min(targetW, targetH) < MIN_RESAMPLE_EDGE_PX) return false;

  const needsResize = targetW < width || targetH < height;
  // 이미 목표 DPI 이하인데 품질도 높으면 스킵 (Tiny skip_if_display_dpi_met 유사)
  const effectiveDpi = Math.min((width / pageW) * 72, (height / pageH) * 72);
  if (!needsResize && effectiveDpi <= opts.targetDpi * sizeScale + 1) return false;
  if (!needsResize && opts.jpegQuality >= 90 && flt.includes('DCTDecode')) return false;

  let pix;
  try {
    pix = image.toPixmap();
  } catch {
    return false;
  }

  const pw = pix.getWidth();
  const ph = pix.getHeight();
  const components = pix.getNumberOfComponents();
  const alpha = pix.getAlpha?.() ? 1 : 0;
  const channels = components + alpha;
  const pixels = pix.getPixels();
  if (!pixels || pw < 1 || ph < 1 || channels < 1) return false;

  /** @type {Buffer | null} */
  let jpeg = null;
  const qualities = [];
  for (let q = Math.max(5, opts.jpegQuality); q >= 5; q -= 5) qualities.push(q);
  if (!qualities.includes(5)) qualities.push(5);

  for (const quality of qualities) {
    try {
      let pipeline = sharp(Buffer.from(pixels), {
        raw: { width: pw, height: ph, channels: /** @type {1|2|3|4} */ (channels) },
      });
      if (channels === 4) pipeline = pipeline.removeAlpha();
      else if (channels === 2) pipeline = pipeline.toColorspace('b-w');
      if (targetW !== pw || targetH !== ph) {
        pipeline = pipeline.resize(targetW, targetH, { fit: 'fill' });
      }
      const next = await pipeline.jpeg({ quality, mozjpeg: true }).toBuffer();
      if (oldSize <= 0 || next.length < oldSize) {
        jpeg = next;
        break;
      }
    } catch {
      // 다음 품질 시도
    }
  }
  if (!jpeg) return false;

  try {
    obj.writeRawStream(jpeg);
    obj.put('Filter', 'DCTDecode');
    obj.put('Width', targetW);
    obj.put('Height', targetH);
    obj.put('BitsPerComponent', 8);
    obj.put('ColorSpace', channels <= 2 ? 'DeviceGray' : 'DeviceRGB');
    obj.put('Length', jpeg.length);
    try {
      obj.delete('DecodeParms');
    } catch {
      // ignore
    }
    try {
      obj.delete('Decode');
    } catch {
      // ignore
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {string} inputPath
 * @param {string} outputPath
 * @param {ReturnType<typeof normalizeCompressOptions>} options
 * @param {string} [password]
 */
export async function compressPdfFile(inputPath, outputPath, options, password = '') {
  const opts = normalizeCompressOptions(options);
  const sourceBytes = fs.readFileSync(inputPath);
  const beforeBytes = sourceBytes.byteLength;
  const pdf = openPdfDocument(sourceBytes, password);

  const jpegQuality = optimizeJpegQuality(opts.imageQualityPercent);
  const targetDpi = Math.max(MIN_IMAGE_DPI, opts.imageDpi);
  const seen = new Set();
  /** @type {{ obj: import('mupdf').PDFObject, pageWidthPt: number, pageHeightPt: number }[]} */
  const images = [];

  const pageCount = pdf.countPages();
  for (let i = 0; i < pageCount; i += 1) {
    try {
      const page = pdf.loadPage(i);
      const bounds = page.getBounds?.() ?? [0, 0, 595, 842];
      const pageWidthPt = Math.max(1, Math.abs(Number(bounds[2]) - Number(bounds[0])) || 595);
      const pageHeightPt = Math.max(1, Math.abs(Number(bounds[3]) - Number(bounds[1])) || 842);
      const res = page.getObject()?.get?.('Resources');
      const xobj = res?.get?.('XObject');
      walkImageObjects(
        xobj,
        (obj) => {
          images.push({ obj, pageWidthPt, pageHeightPt });
        },
        seen,
      );
    } catch {
      // 페이지 단위 실패 무시
    }
  }

  let changed = 0;
  for (const entry of images) {
    try {
      const ok = await recompressOneImage(pdf, entry.obj, {
        targetDpi,
        jpegQuality,
        sizePercent: opts.imageSizePercent,
        pageWidthPt: entry.pageWidthPt,
        pageHeightPt: entry.pageHeightPt,
      });
      if (ok) changed += 1;
    } catch {
      // Tiny 와 같이 문제 이미지는 건너뜀
    }
  }

  const saved = pdf.saveToBuffer('compress,garbage');
  const outBytes = Buffer.from(saved.asUint8Array());
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, outBytes);

  return {
    inputPath,
    outputPath,
    beforeBytes,
    afterBytes: outBytes.byteLength,
    imagesTotal: images.length,
    imagesChanged: changed,
    options: opts,
  };
}

/**
 * @param {string} inputPath
 * @param {string} outputDir
 * @param {ReturnType<typeof normalizeCompressOptions>} options
 */
/**
 * @param {string} inputPath
 * @param {string} outputDir
 * @param {ReturnType<typeof normalizeCompressOptions>} options
 * @param {string} [password]
 */
export async function compressPdfToDir(inputPath, outputDir, options, password = '') {
  const base = path.basename(inputPath, path.extname(inputPath));
  const outDir = outputDir?.trim()
    ? path.resolve(outputDir)
    : path.dirname(path.resolve(inputPath));
  const outputPath = path.join(outDir, `${base}_optimize.pdf`);
  return compressPdfFile(inputPath, outputPath, options, password);
}
