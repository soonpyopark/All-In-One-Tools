import fs from 'node:fs';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp']);

/* -------------------------------------------------------------------------- */
/* parameters                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Pixel values below are defined for a 1080-pixel-high screenshot and scaled by
 * `height / 1080`, so 4K / retina captures behave the same as 1080p ones.
 */
const BASE_PX = {
  margin: 8,
  gapTolerance: 8,
  edgeMaxTrim: 60,
  minCropSize: 100,
};

const DETECT = {
  excludeTopRatio: 0.08,
  excludeBottomRatio: 0.12,
  columnOnRatio: 0.55,
  rowOnRatio: 0.55,
  /** A detected run wider than this is the whole window, not the book. */
  maxWidthRatio: 0.85,
  aspectMin: 0.4,
  /** Wide enough for a two-page spread. */
  aspectMax: 2.2,
  edgeDarkThreshold: 130,
  edgeDarkRatio: 0.75,
  edgeMeanThreshold: 110,
  /** How many images take part in the region vote. */
  sampleCount: 9,
  /** Boxes overlapping the median by at least this much are "in agreement". */
  agreeIou: 0.85,
};

/** Fallback region (ratios of the image) when nothing can be detected. */
const FALLBACK_BOX = { left: 0.02, top: 0.08, width: 600 / 1920, height: 890 / 1080 };

const COMPARE = {
  width: 256,
  height: 352,
  blurSigma: 0.8,
  /** A pixel counts as changed when no pixel within 1px of the other image is this close. */
  pixelTolerance: 24,
  /** Reject as duplicate when any 16×16 cell has more than this share of changed pixels. */
  blockLimit: 0.12,
  blockGrid: 16,
  /** Frames with less grey-level variation than this are blank (solid colour). */
  blankStdDev: 4,
};

/* -------------------------------------------------------------------------- */
/* helpers                                                                    */
/* -------------------------------------------------------------------------- */

/** @param {string} name */
function naturalSortKey(name) {
  return String(name)
    .split(/(\d+)/)
    .map((part) => (/^\d+$/.test(part) ? Number(part) : part.toLowerCase()));
}

/**
 * @param {string} a
 * @param {string} b
 */
function naturalCompare(a, b) {
  const ka = naturalSortKey(a);
  const kb = naturalSortKey(b);
  const len = Math.max(ka.length, kb.length);
  for (let i = 0; i < len; i += 1) {
    const x = ka[i];
    const y = kb[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    if (typeof x === 'number' && typeof y === 'number') return x - y;
    return String(x).localeCompare(String(y));
  }
  return 0;
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** @param {number[]} values */
function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * @typedef {{ left: number, top: number, width: number, height: number }} Box
 * Boxes are either pixels or ratios (0..1) of the image — the caller knows which.
 */

/**
 * @param {string[]} paths
 * @returns {string[]} existing image files in natural filename order
 */
function normalizeInputs(paths) {
  return [...new Set((paths ?? []).map((p) => path.resolve(String(p ?? '').trim())).filter(Boolean))]
    .filter((p) => fs.existsSync(p) && IMAGE_EXTS.has(path.extname(p).toLowerCase()))
    .sort((a, b) => naturalCompare(path.basename(a), path.basename(b)));
}

/** @param {Buffer} input */
async function loadGray(input) {
  const { data, info } = await sharp(input).removeAlpha().grayscale().raw().toBuffer({ resolveWithObject: true });
  return { gray: new Uint8Array(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };
}

/**
 * Otsu threshold on a subsampled grey image.
 * @param {Uint8Array} gray
 */
function otsuThreshold(gray) {
  const hist = new Float64Array(256);
  const step = Math.max(1, Math.floor(gray.length / 400_000));
  let total = 0;
  for (let i = 0; i < gray.length; i += step) {
    hist[gray[i]] += 1;
    total += 1;
  }
  let sum = 0;
  for (let t = 0; t < 256; t += 1) sum += t * hist[t];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let threshold = 128;
  for (let t = 0; t < 256; t += 1) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) {
      best = between;
      threshold = t;
    }
  }
  return threshold;
}

/* -------------------------------------------------------------------------- */
/* region detection (one image)                                               */
/* -------------------------------------------------------------------------- */

/**
 * Longest run of `true` values, bridging gaps up to `gapTolerance`.
 * @param {ArrayLike<number>} ratios
 * @param {number} minRatio
 * @param {number} gapTolerance
 * @returns {[number, number][]}
 */
function findRuns(ratios, minRatio, gapTolerance) {
  /** @type {[number, number][]} */
  const runs = [];
  let start = -1;
  let end = -1;
  let gap = 0;
  for (let i = 0; i < ratios.length; i += 1) {
    if (ratios[i] >= minRatio) {
      if (start < 0) start = i;
      end = i + 1;
      gap = 0;
    } else if (start >= 0) {
      gap += 1;
      if (gap > gapTolerance) {
        runs.push([start, end]);
        start = -1;
        gap = 0;
      }
    }
  }
  if (start >= 0) runs.push([start, end]);
  return runs;
}

/** @param {[number, number][]} runs */
function widestRun(runs) {
  let best = null;
  for (const run of runs) {
    if (!best || run[1] - run[0] > best[1] - best[0]) best = run;
  }
  return best;
}

/**
 * Finds the largest uniformly bright (or dark) rectangle — the book page.
 *
 * @param {Uint8Array} gray
 * @param {number} width
 * @param {number} height
 * @param {'bright' | 'dark'} polarity
 * @param {number} threshold
 * @param {number} scale px scale factor (height / 1080)
 * @returns {Box | null} pixel box
 */
function detectPanel(gray, width, height, polarity, threshold, scale) {
  const gap = Math.max(1, Math.round(BASE_PX.gapTolerance * scale));
  const margin = Math.round(BASE_PX.margin * scale);
  const minSize = Math.round(BASE_PX.minCropSize * scale);

  const top = Math.floor(height * DETECT.excludeTopRatio);
  const bottom = Math.floor(height * DETECT.excludeBottomRatio);
  const roiH = height - top - bottom;
  if (roiH <= 0) return null;

  const on = polarity === 'bright' ? (v) => v > threshold : (v) => v < threshold;

  const colRatio = new Float32Array(width);
  for (let y = 0; y < roiH; y += 1) {
    const row = (top + y) * width;
    for (let x = 0; x < width; x += 1) {
      if (on(gray[row + x])) colRatio[x] += 1;
    }
  }
  for (let x = 0; x < width; x += 1) colRatio[x] /= roiH;

  const colRuns = findRuns(colRatio, DETECT.columnOnRatio, gap).filter(
    ([a, b]) => b - a >= minSize && b - a <= width * DETECT.maxWidthRatio,
  );
  const colRun = widestRun(colRuns);
  if (!colRun) return null;
  const [x1, x2] = colRun;

  const rowRatio = new Float32Array(roiH);
  const panelW = x2 - x1;
  for (let y = 0; y < roiH; y += 1) {
    const row = (top + y) * width;
    let count = 0;
    for (let x = x1; x < x2; x += 1) if (on(gray[row + x])) count += 1;
    rowRatio[y] = count / panelW;
  }
  // Text lines can dip below the ratio, so take the whole span from the first to
  // the last row that still looks like page background.
  let rowFirst = -1;
  let rowLast = -1;
  for (let y = 0; y < roiH; y += 1) {
    if (rowRatio[y] >= DETECT.rowOnRatio) {
      if (rowFirst < 0) rowFirst = y;
      rowLast = y + 1;
    }
  }
  if (rowFirst < 0) return null;

  // The scan window leaves out the top / bottom strips (title bar, taskbar); the
  // page may reach into them, so keep growing while rows still look like the page.
  const rowOn = (y) => {
    let count = 0;
    const row = y * width;
    for (let x = x1; x < x2; x += 1) if (on(gray[row + x])) count += 1;
    return count / panelW >= DETECT.rowOnRatio;
  };
  let pageTop = rowFirst + top;
  let pageBottom = rowLast + top;
  if (rowFirst === 0) while (pageTop > 0 && rowOn(pageTop - 1)) pageTop -= 1;
  if (rowLast === roiH) while (pageBottom < height && rowOn(pageBottom)) pageBottom += 1;

  const left = Math.max(0, x1 + margin);
  const right = Math.min(width, x2 - margin);
  const topY = Math.max(0, pageTop + margin);
  const bottomY = Math.min(height, pageBottom - margin);
  if (right - left < minSize || bottomY - topY < minSize) return null;

  const aspect = (right - left) / (bottomY - topY);
  if (aspect < DETECT.aspectMin || aspect > DETECT.aspectMax) return null;
  return { left, top: topY, width: right - left, height: bottomY - topY };
}

/**
 * Trims dark window borders that stick to the detected box (bright pages only).
 *
 * @param {Uint8Array} gray
 * @param {number} width
 * @param {Box} box pixel box
 * @param {number} scale
 * @returns {Box}
 */
function trimDarkEdges(gray, width, box, scale) {
  const maxTrim = Math.round(BASE_PX.edgeMaxTrim * scale);
  const minSize = Math.round(BASE_PX.minCropSize * scale);
  let { left, top } = box;
  let right = box.left + box.width;
  let bottom = box.top + box.height;

  const isDark = (sum, dark, n) => dark / n >= DETECT.edgeDarkRatio || sum / n <= DETECT.edgeMeanThreshold;
  const rowDark = (y) => {
    let sum = 0;
    let dark = 0;
    for (let x = left; x < right; x += 1) {
      const v = gray[y * width + x];
      sum += v;
      if (v < DETECT.edgeDarkThreshold) dark += 1;
    }
    return isDark(sum, dark, right - left);
  };
  const colDark = (x) => {
    let sum = 0;
    let dark = 0;
    for (let y = top; y < bottom; y += 1) {
      const v = gray[y * width + x];
      sum += v;
      if (v < DETECT.edgeDarkThreshold) dark += 1;
    }
    return isDark(sum, dark, bottom - top);
  };

  for (let i = 0; i < maxTrim && bottom - top > minSize && rowDark(top); i += 1) top += 1;
  for (let i = 0; i < maxTrim && bottom - top > minSize && rowDark(bottom - 1); i += 1) bottom -= 1;
  for (let i = 0; i < maxTrim && right - left > minSize && colDark(left); i += 1) left += 1;
  for (let i = 0; i < maxTrim && right - left > minSize && colDark(right - 1); i += 1) right -= 1;
  return { left, top, width: right - left, height: bottom - top };
}

/**
 * @param {Buffer} buf
 * @returns {Promise<Box | null>} detected region as ratios of the image
 */
async function detectRatioBox(buf) {
  const { gray, width, height } = await loadGray(buf);
  const scale = Math.max(0.25, height / 1080);
  const otsu = otsuThreshold(gray);

  let box = detectPanel(gray, width, height, 'bright', clamp(otsu, 120, 225), scale);
  if (box) {
    box = trimDarkEdges(gray, width, box, scale);
  } else {
    // Dark reading theme: the page is the large dark rectangle.
    box = detectPanel(gray, width, height, 'dark', clamp(otsu, 30, 140), scale);
  }
  if (!box) return null;
  return {
    left: box.left / width,
    top: box.top / height,
    width: box.width / width,
    height: box.height / height,
  };
}

/* -------------------------------------------------------------------------- */
/* region detection (many images → one vote)                                  */
/* -------------------------------------------------------------------------- */

/** @param {Box} a @param {Box} b */
function iou(a, b) {
  const x1 = Math.max(a.left, b.left);
  const y1 = Math.max(a.top, b.top);
  const x2 = Math.min(a.left + a.width, b.left + b.width);
  const y2 = Math.min(a.top + a.height, b.top + b.height);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.width * a.height + b.width * b.height - inter;
  return union > 0 ? inter / union : 0;
}

/** @param {Box[]} boxes */
function medianBox(boxes) {
  return {
    left: median(boxes.map((b) => b.left)),
    top: median(boxes.map((b) => b.top)),
    width: median(boxes.map((b) => b.width)),
    height: median(boxes.map((b) => b.height)),
  };
}

/**
 * @param {number} count
 * @param {number} want
 * @returns {number[]} indexes spread evenly over `count` items
 */
function sampleIndexes(count, want) {
  const k = Math.min(count, want);
  if (k <= 1) return [0];
  const set = new Set();
  for (let i = 0; i < k; i += 1) set.add(Math.round((i * (count - 1)) / (k - 1)));
  return [...set];
}

/**
 * Detects the book region on up to nine images spread over the whole list and
 * takes the consensus, so one odd page (cover, illustration, blank) cannot
 * decide the region for everything.
 *
 * @param {string[]} inputPaths sorted image paths
 * @param {{ signal?: AbortSignal, onLog?: (line: string) => void }} [opts]
 * @returns {Promise<{
 *   box: Box,
 *   method: 'consensus' | 'fallback',
 *   sampled: number,
 *   detected: number,
 *   agreed: number,
 * }>}
 */
export async function detectEbookRegion(inputPaths, opts = {}) {
  const paths = normalizeInputs(inputPaths);
  if (paths.length === 0) throw new Error('처리할 이미지가 없습니다.');

  const indexes = sampleIndexes(paths.length, DETECT.sampleCount);
  /** @type {Box[]} */
  const boxes = [];
  for (const index of indexes) {
    if (opts.signal?.aborted) throw new Error('작업이 취소되었습니다.');
    try {
      const box = await detectRatioBox(fs.readFileSync(paths[index]));
      if (box) boxes.push(box);
      else opts.onLog?.(`영역 감지 실패: ${path.basename(paths[index])}`);
    } catch (err) {
      opts.onLog?.(`영역 감지 오류: ${path.basename(paths[index])} (${err instanceof Error ? err.message : err})`);
    }
  }

  if (boxes.length === 0) {
    return { box: { ...FALLBACK_BOX }, method: 'fallback', sampled: indexes.length, detected: 0, agreed: 0 };
  }

  let box = medianBox(boxes);
  const agreeing = boxes.filter((b) => iou(b, box) >= DETECT.agreeIou);
  if (agreeing.length > 0 && agreeing.length < boxes.length) box = medianBox(agreeing);
  return {
    box,
    method: 'consensus',
    sampled: indexes.length,
    detected: boxes.length,
    agreed: agreeing.length || boxes.length,
  };
}

/**
 * @param {Box} ratio
 * @param {number} width
 * @param {number} height
 * @returns {Box} pixel box, always inside the image
 */
function ratioToPixels(ratio, width, height) {
  const left = clamp(Math.round(ratio.left * width), 0, width - 1);
  const top = clamp(Math.round(ratio.top * height), 0, height - 1);
  return {
    left,
    top,
    width: clamp(Math.round(ratio.width * width), 1, width - left),
    height: clamp(Math.round(ratio.height * height), 1, height - top),
  };
}

/**
 * @param {unknown} raw user supplied region (ratios of the image)
 * @returns {Box | null}
 */
export function normalizeManualCrop(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const src = /** @type {Record<string, unknown>} */ (raw);
  const left = Number(src.left);
  const top = Number(src.top);
  const width = Number(src.width);
  const height = Number(src.height);
  if (![left, top, width, height].every(Number.isFinite)) return null;
  const l = clamp(left, 0, 0.99);
  const t = clamp(top, 0, 0.99);
  const w = clamp(width, 0.05, 1 - l);
  const h = clamp(height, 0.05, 1 - t);
  return { left: l, top: t, width: w, height: h };
}

/**
 * Data for the region preview: the first image (downscaled) and the auto region.
 *
 * @param {{ inputPaths: string[] }} args
 */
export async function previewEbookRegion(args) {
  const paths = normalizeInputs(args.inputPaths);
  if (paths.length === 0) throw new Error('미리볼 이미지가 없습니다.');

  const detection = await detectEbookRegion(paths);
  const first = fs.readFileSync(paths[0]);
  const meta = await sharp(first).metadata();
  const jpeg = await sharp(first)
    .resize({ width: Math.min(meta.width ?? 960, 960), withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toBuffer();

  return {
    imagePath: paths[0],
    imageWidth: meta.width ?? 0,
    imageHeight: meta.height ?? 0,
    previewDataUrl: `data:image/jpeg;base64,${jpeg.toString('base64')}`,
    detected: detection.box,
    method: detection.method,
    sampled: detection.sampled,
    detectedCount: detection.detected,
    agreed: detection.agreed,
  };
}

/* -------------------------------------------------------------------------- */
/* duplicate / blank detection                                                */
/* -------------------------------------------------------------------------- */

/** @param {Buffer} png */
async function compareData(png) {
  const { data } = await sharp(png)
    .removeAlpha()
    .resize(COMPARE.width, COMPARE.height, { fit: 'fill' })
    .grayscale()
    .blur(COMPARE.blurSigma)
    .raw()
    .toBuffer({ resolveWithObject: true });
  return new Uint8Array(data.buffer, data.byteOffset, data.length);
}

/** @param {Uint8Array} data */
function greyStdDev(data) {
  let sum = 0;
  for (let i = 0; i < data.length; i += 1) sum += data[i];
  const mean = sum / data.length;
  let variance = 0;
  for (let i = 0; i < data.length; i += 1) variance += (data[i] - mean) ** 2;
  return Math.sqrt(variance / data.length);
}

/**
 * Share of pixels that really differ, tolerant to 1px shifts and anti-aliasing,
 * plus the worst 16×16 cell (catches a small but concentrated change such as
 * one different sentence).
 *
 * @param {Uint8Array} a
 * @param {Uint8Array} b
 * @returns {{ ratio: number, worstBlock: number }}
 */
function changeStats(a, b) {
  const { width: W, height: H, pixelTolerance: T, blockGrid } = COMPARE;
  const cellW = Math.ceil(W / blockGrid);
  const cellH = Math.ceil(H / blockGrid);
  const cellChanged = new Uint32Array(blockGrid * blockGrid);
  const cellTotal = new Uint32Array(blockGrid * blockGrid);

  let changed = 0;
  let total = 0;
  for (let y = 1; y < H - 1; y += 1) {
    for (let x = 1; x < W - 1; x += 1) {
      const i = y * W + x;
      const av = a[i];
      let close = false;
      for (let dy = -1; dy <= 1 && !close; dy += 1) {
        const row = (y + dy) * W + x;
        for (let dx = -1; dx <= 1; dx += 1) {
          if (Math.abs(av - b[row + dx]) <= T) {
            close = true;
            break;
          }
        }
      }
      const cell = Math.floor(y / cellH) * blockGrid + Math.floor(x / cellW);
      cellTotal[cell] += 1;
      total += 1;
      if (!close) {
        changed += 1;
        cellChanged[cell] += 1;
      }
    }
  }
  let worstBlock = 0;
  for (let c = 0; c < cellTotal.length; c += 1) {
    if (cellTotal[c] > 0) worstBlock = Math.max(worstBlock, cellChanged[c] / cellTotal[c]);
  }
  return { ratio: total ? changed / total : 0, worstBlock };
}

/* -------------------------------------------------------------------------- */
/* pdf                                                                        */
/* -------------------------------------------------------------------------- */

/** Largest page edge the PDF format allows (points). */
const PDF_MAX_EDGE = 14400;

/**
 * File name of the merged PDF: empty → `output.pdf`; any folder part and
 * characters Windows does not allow are dropped; `.pdf` is added when missing.
 *
 * @param {unknown} raw
 */
export function normalizePdfName(raw) {
  let name = path.basename(String(raw ?? '').trim().replace(/\\/g, '/'));
  name = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').replace(/[. ]+$/g, '').trim();
  name = name.replace(/\.pdf$/i, '').replace(/[. ]+$/g, '');
  if (!name || /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(name)) name = 'output';
  return `${name}.pdf`;
}

/**
 * Merges `pagesDir/0001.png …` into one PDF, one page per image sized to the image.
 * Written to a temporary file first so a cancelled run never leaves a broken PDF.
 *
 * @param {{
 *   pagesDir: string,
 *   pageCount: number,
 *   target: string,
 *   quality: 'jpeg' | 'png',
 *   signal?: AbortSignal,
 *   onProgress?: (ratio: number) => void,
 *   log?: (line: string) => void,
 * }} args
 * @returns {Promise<string>} path of the PDF
 */
async function buildPdf({ pagesDir, pageCount, target, quality, signal, onProgress, log }) {
  const doc = await PDFDocument.create();

  for (let n = 1; n <= pageCount; n += 1) {
    if (signal?.aborted) throw new Error('작업이 취소되었습니다.');
    const file = path.join(pagesDir, `${String(n).padStart(4, '0')}.png`);
    const png = fs.readFileSync(file);

    let image;
    if (quality === 'png') {
      image = await doc.embedPng(png);
    } else {
      const jpeg = await sharp(png).flatten({ background: '#ffffff' }).jpeg({ quality: 90, chromaSubsampling: '4:4:4' }).toBuffer();
      image = await doc.embedJpg(jpeg);
    }

    const scale = Math.min(1, PDF_MAX_EDGE / Math.max(image.width, image.height));
    const width = image.width * scale;
    const height = image.height * scale;
    const page = doc.addPage([width, height]);
    page.drawImage(image, { x: 0, y: 0, width, height });
    onProgress?.(n / pageCount);
  }

  const bytes = await doc.save();
  if (signal?.aborted) throw new Error('작업이 취소되었습니다.');
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, bytes);
  fs.renameSync(tmp, target);
  log?.(`PDF 저장: ${path.basename(target)} (${pageCount}쪽, ${(bytes.length / 1024 / 1024).toFixed(1)} MB)`);
  return target;
}

/* -------------------------------------------------------------------------- */
/* main                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Results are written straight into `outputDir`:
 *   output/0001.png, 0002.png, ...   extracted pages (always kept)
 *   <pdfName>.pdf                    the pages merged into one PDF (`makePdf`)
 *   duplicated/<name>.png            pages dropped as near-duplicates
 *   blank/<name>.png                 blank (solid colour) frames dropped
 *
 * @param {{
 *   inputPaths: string[],
 *   outputDir: string,
 *   manualCrop?: Box | null,
 *   consecutiveImages?: number,
 *   similarityPercent?: number,
 *   skipBlank?: boolean,
 *   makePdf?: boolean,
 *   pdfName?: string,
 *   pdfQuality?: 'jpeg' | 'png',
 *   signal?: AbortSignal,
 *   onProgress?: (ratio: number) => void,
 *   onLog?: (line: string) => void,
 * }} args
 *   `similarityPercent`: two images are duplicates when at most
 *   `100 − similarityPercent` % of their pixels differ. `manualCrop` is in
 *   ratios (0..1) of the image and skips auto detection. `makePdf` (default on)
 *   merges the saved pages into `pdfName` (default `output.pdf`).
 */
export async function processEbookExtract(args) {
  const inputPaths = normalizeInputs(args.inputPaths);
  if (inputPaths.length === 0) throw new Error('처리할 이미지가 없습니다.');

  const outputDir = path.resolve(String(args.outputDir ?? '').trim() || path.dirname(inputPaths[0]));
  const pagesDir = path.join(outputDir, 'output');
  const duplicatesDir = path.join(outputDir, 'duplicated');
  const blankDir = path.join(outputDir, 'blank');
  fs.mkdirSync(pagesDir, { recursive: true });

  const windowSize = Math.max(1, Number(args.consecutiveImages) || 3);
  const similarityPercent = clamp(Number(args.similarityPercent) || 99.9, 80, 100);
  const maxChanged = (100 - similarityPercent) / 100;
  const skipBlank = args.skipBlank === true;
  const makePdf = args.makePdf !== false;
  /** Share of the progress bar the image loop uses (the rest is for the PDF). */
  const loopSpan = makePdf ? 0.8 : 0.92;

  const log = (line) => args.onLog?.(line);
  const aborted = () => {
    if (args.signal?.aborted) throw new Error('작업이 취소되었습니다.');
  };
  args.onProgress?.(0.02);

  /* ---- region ---- */
  const manual = normalizeManualCrop(args.manualCrop);
  /** @type {Box} */
  let region;
  if (manual) {
    region = manual;
    log(
      `수동 영역 사용: 왼쪽 ${(manual.left * 100).toFixed(1)}% · 위 ${(manual.top * 100).toFixed(1)}% · 너비 ${(manual.width * 100).toFixed(1)}% · 높이 ${(manual.height * 100).toFixed(1)}%`,
    );
  } else {
    const detection = await detectEbookRegion(inputPaths, { signal: args.signal, onLog: log });
    region = detection.box;
    if (detection.method === 'consensus') {
      log(
        `영역 자동 감지: ${detection.sampled}장 중 ${detection.detected}장에서 감지, ${detection.agreed}장 일치 ` +
          `(왼쪽 ${(region.left * 100).toFixed(1)}% · 위 ${(region.top * 100).toFixed(1)}% · 너비 ${(region.width * 100).toFixed(1)}% · 높이 ${(region.height * 100).toFixed(1)}%)`,
      );
      if (detection.agreed < Math.ceil(detection.detected / 2)) {
        log('주의: 감지된 영역이 서로 많이 다릅니다. 미리보기에서 수동으로 영역을 지정해 보세요.');
      }
    } else {
      log('주의: 영역을 자동으로 찾지 못해 기본 비율 영역을 사용합니다. 미리보기에서 수동으로 지정해 보세요.');
    }
  }
  args.onProgress?.(0.06);

  /* ---- extraction ---- */
  /** @type {{ index: number, data: Uint8Array, label: string }[]} */
  const kept = [];
  let outIndex = 1;
  let duplicates = 0;
  let blanks = 0;

  for (let i = 0; i < inputPaths.length; i += 1) {
    aborted();
    const filePath = inputPaths[i];
    const file = path.basename(filePath);
    args.onProgress?.(0.06 + (loopSpan * i) / inputPaths.length);

    try {
      const raw = fs.readFileSync(filePath);
      const meta = await sharp(raw).metadata();
      const box = ratioToPixels(region, meta.width ?? 1, meta.height ?? 1);
      const minSize = Math.round(BASE_PX.minCropSize * Math.max(0.25, (meta.height ?? 1080) / 1080));
      if (box.width < minSize || box.height < minSize) {
        log(`이미지 ${file}: 영역이 너무 작아 건너뜁니다.`);
        continue;
      }
      const cropped = await sharp(raw).extract(box).png().toBuffer();
      const data = await compareData(cropped);

      if (skipBlank && greyStdDev(data) < COMPARE.blankStdDev) {
        blanks += 1;
        fs.mkdirSync(blankDir, { recursive: true });
        fs.writeFileSync(path.join(blankDir, `${path.parse(file).name}.png`), cropped);
        log(`빈 화면 제외: ${file}`);
        continue;
      }

      let duplicateOf = null;
      let stats = null;
      for (const item of kept) {
        if (i - item.index >= windowSize) continue;
        const s = changeStats(data, item.data);
        if (s.ratio <= maxChanged && s.worstBlock <= COMPARE.blockLimit) {
          duplicateOf = item;
          stats = s;
          break;
        }
      }
      if (duplicateOf && stats) {
        duplicates += 1;
        fs.mkdirSync(duplicatesDir, { recursive: true });
        fs.writeFileSync(path.join(duplicatesDir, `${path.parse(file).name}.png`), cropped);
        log(`중복 제거: ${file} (변경 픽셀 ${(stats.ratio * 100).toFixed(3)}%, 기준: ${duplicateOf.label})`);
        continue;
      }

      kept.push({ index: i, data, label: file });
      while (kept.length > 0 && i - kept[0].index >= windowSize) kept.shift();

      const enhanced = await sharp(cropped).sharpen({ sigma: 1, m1: 0.5, m2: 0.25 }).png().toBuffer();
      const outName = `${String(outIndex).padStart(4, '0')}.png`;
      fs.writeFileSync(path.join(pagesDir, outName), enhanced);
      log(`${file} → ${outName} 저장`);
      outIndex += 1;
    } catch (err) {
      if (err instanceof Error && err.message === '작업이 취소되었습니다.') throw err;
      log(`이미지 ${file} 처리 중 오류: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const outputCount = outIndex - 1;
  if (outputCount === 0) throw new Error('저장된 결과가 없습니다. 영역/중복 설정을 확인해 주세요.');

  /* ---- pdf ---- */
  let pdfPath = '';
  if (makePdf) {
    try {
      pdfPath = await buildPdf({
        pagesDir,
        pageCount: outputCount,
        target: path.join(outputDir, normalizePdfName(args.pdfName)),
        quality: args.pdfQuality === 'png' ? 'png' : 'jpeg',
        signal: args.signal,
        onProgress: (ratio) => args.onProgress?.(0.06 + loopSpan + (0.98 - 0.06 - loopSpan) * ratio),
        log,
      });
    } catch (err) {
      if (err instanceof Error && err.message === '작업이 취소되었습니다.') throw err;
      log(`주의: PDF를 만들지 못했습니다 (PNG는 저장되어 있습니다): ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  args.onProgress?.(1);
  log(
    `완료: 출력 ${outputCount}개` +
      (duplicates ? `, 중복 제외 ${duplicates}개` : '') +
      (blanks ? `, 빈 화면 제외 ${blanks}개` : ''),
  );

  return {
    outputCount,
    duplicateCount: duplicates,
    blankCount: blanks,
    outputDir,
    pagesDir,
    pdfPath,
  };
}

export const EBOOK_INPUT_EXTS = [...IMAGE_EXTS];
