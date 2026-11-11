/**
 * Tiny PDF Editor(`pdf_editor/ocr_engine.py`)의 PP-OCRv5 ONNX 엔진을 Node 로 옮긴 것입니다.
 * 검출 1회 → 선택 언어별 인식 → 신뢰도 높은 결과 채택.
 */
import fs from 'node:fs';
import path from 'node:path';
import ort from 'onnxruntime-node';
import sharp from 'sharp';
import { DET_MODEL, REC_MODELS, ensureModels } from './models.js';

const DET_LONG_SIDE = 960;
const DET_THRESH = 0.3;
const DET_BOX_THRESH = 0.6;
const DET_UNCLIP_RATIO = 1.5;
const DET_MIN_SIZE = 3;
const DET_MAX_BOXES = 1000;
const REC_HEIGHT = 48;
const REC_MIN_WIDTH = 320;
const REC_MAX_WIDTH = 3200;
const TEXT_SCORE = 0.5;
const DET_MEAN = [0.485, 0.456, 0.406];
const DET_STD = [0.229, 0.224, 0.225];
const IOU_THRESH = 0.45;

/**
 * @typedef {{ text: string, x: number, y: number, w: number, h: number, conf: number }} OcrLine
 */

/**
 * Tiny 와 같은 YAML character_dict 파서.
 * @param {string} yml
 * @returns {string[]}
 */
export function parseCharacterDict(yml) {
  const chars = [];
  let inDict = false;
  let dictIndent = -1;
  for (const line of yml.split(/\r?\n/)) {
    if (!inDict) {
      const stripped = line.trimStart();
      if (stripped.startsWith('character_dict:')) {
        inDict = true;
        dictIndent = line.length - stripped.length;
      }
      continue;
    }
    const matchIndent = line.length - line.trimStart().length;
    const body = line.trimStart();
    if (body.startsWith('- ') && matchIndent >= dictIndent) {
      let value = body.slice(2);
      if (
        (value.startsWith("'") && value.endsWith("'")) ||
        (value.startsWith('"') && value.endsWith('"'))
      ) {
        value = value.slice(1, -1).replace(/''/g, "'");
      }
      chars.push(value);
      continue;
    }
    if (line.trim()) break;
  }
  return chars;
}

/**
 * @param {Float32Array | number[]} data
 * @param {number} timeSteps
 * @param {number} classes
 * @param {string[]} dictionary
 * @returns {{ text: string, conf: number } | null}
 */
function ctcDecode(data, timeSteps, classes, dictionary) {
  let text = '';
  let confSum = 0;
  let confCount = 0;
  let prev = -1;
  for (let step = 0; step < timeSteps; step += 1) {
    const offset = step * classes;
    let best = 0;
    let bestV = -Infinity;
    for (let c = 0; c < classes; c += 1) {
      const v = data[offset + c];
      if (v > bestV) {
        bestV = v;
        best = c;
      }
    }
    const repeat = best === prev;
    prev = best;
    if (best === 0 || repeat) continue;
    let prob = bestV;
    if (prob > 1.0001 || prob < 0) {
      let denom = 0;
      for (let c = 0; c < classes; c += 1) denom += Math.exp(data[offset + c] - bestV);
      prob = denom ? 1 / denom : 0;
    }
    confSum += prob;
    confCount += 1;
    if (best >= 1 && best <= dictionary.length) text += dictionary[best - 1];
    else if (best === dictionary.length + 1) text += ' ';
  }
  if (!text) return null;
  return { text, conf: confCount ? confSum / confCount : 0 };
}

/** @param {OcrLine} a @param {OcrLine} b */
function iou(a, b) {
  const ax2 = a.x + a.w;
  const ay2 = a.y + a.h;
  const bx2 = b.x + b.w;
  const by2 = b.y + b.h;
  const ix1 = Math.max(a.x, b.x);
  const iy1 = Math.max(a.y, b.y);
  const ix2 = Math.min(ax2, bx2);
  const iy2 = Math.min(ay2, by2);
  const iw = Math.max(0, ix2 - ix1);
  const ih = Math.max(0, iy2 - iy1);
  const inter = iw * ih;
  if (inter <= 0) return 0;
  const union = a.w * a.h + b.w * b.h - inter;
  return union ? inter / union : 0;
}

/** @param {OcrLine} a @param {OcrLine} b */
function yOverlapRatio(a, b) {
  const top = Math.max(a.y, b.y);
  const bottom = Math.min(a.y + a.h, b.y + b.h);
  const overlap = Math.max(0, bottom - top);
  return overlap / Math.max(Math.min(a.h, b.h), 1);
}

/** @param {OcrLine[]} items */
function dedupLines(items) {
  const ranked = [...items].sort((a, b) => b.conf - a.conf);
  /** @type {OcrLine[]} */
  const kept = [];
  for (const item of ranked) {
    let duplicate = false;
    for (const other of kept) {
      if (iou(item, other) >= IOU_THRESH) {
        duplicate = true;
        break;
      }
      if (item.text.trim() === other.text.trim() && yOverlapRatio(item, other) >= 0.6) {
        duplicate = true;
        break;
      }
    }
    if (!duplicate) kept.push(item);
  }
  kept.sort((a, b) => a.y - b.y || a.x - b.x);
  return kept;
}

/**
 * @param {Uint8Array} rgb
 * @param {number} width
 * @param {number} height
 * @param {number} targetW
 * @param {number} targetH
 */
async function resizeRgb(rgb, width, height, targetW, targetH) {
  const out = await sharp(Buffer.from(rgb), { raw: { width, height, channels: 3 } })
    .resize(targetW, targetH, { fit: 'fill' })
    .raw()
    .toBuffer();
  return new Uint8Array(out);
}

/**
 * @param {Float32Array} prob flat det_w * det_h
 * @param {number} width
 * @param {number} height
 */
function componentBoxes(prob, width, height) {
  const visited = new Uint8Array(width * height);
  /** @type {[number, number, number, number, number][]} */
  const boxes = [];
  for (let start = 0; start < width * height; start += 1) {
    if (visited[start] || prob[start] <= DET_THRESH) continue;
    let x1 = start % width;
    let x2 = x1;
    let y1 = (start / width) | 0;
    let y2 = y1;
    let total = 0;
    let count = 0;
    const stack = [start];
    visited[start] = 1;
    while (stack.length) {
      const pos = stack.pop();
      const px = pos % width;
      const py = (pos / width) | 0;
      total += prob[pos];
      count += 1;
      if (px < x1) x1 = px;
      if (px > x2) x2 = px;
      if (py < y1) y1 = py;
      if (py > y2) y2 = py;
      const neighbors = [];
      if (px > 0) neighbors.push(pos - 1);
      if (px < width - 1) neighbors.push(pos + 1);
      if (py > 0) neighbors.push(pos - width);
      if (py < height - 1) neighbors.push(pos + width);
      for (const nxt of neighbors) {
        if (!visited[nxt] && prob[nxt] > DET_THRESH) {
          visited[nxt] = 1;
          stack.push(nxt);
        }
      }
    }
    if (x2 - x1 + 1 < DET_MIN_SIZE && y2 - y1 + 1 < DET_MIN_SIZE) continue;
    boxes.push([x1, y1, x2, y2, total / Math.max(count, 1)]);
  }
  return boxes
    .filter((b) => b[4] >= DET_BOX_THRESH)
    .sort((a, b) => a[1] - b[1] || a[0] - b[0]);
}

class OcrEngine {
  /**
   * @param {string} folder
   * @param {string[]} recModelIds
   */
  constructor(folder, recModelIds) {
    this.folder = folder;
    this.recModelIds = recModelIds;
    /** @type {ort.InferenceSession | null} */
    this._det = null;
    /** @type {Map<string, { session: ort.InferenceSession, dict: string[] }>} */
    this._rec = new Map();
  }

  async init() {
    // executionProviders 를 명시하면 백엔드 등록이 안 된 환경에서 실패할 수 있어 기본값에 맡깁니다.
    const options = { logSeverityLevel: 3 };
    this._det = await ort.InferenceSession.create(path.join(this.folder, DET_MODEL.filename), options);
    for (const id of this.recModelIds) {
      const spec = REC_MODELS[id];
      if (!spec) continue;
      const session = await ort.InferenceSession.create(path.join(this.folder, spec.onnx), options);
      const yml = fs.readFileSync(path.join(this.folder, spec.dict), 'utf8');
      const dict = parseCharacterDict(yml);
      if (dict.length === 0) throw new Error(`OCR 문자표를 읽지 못했습니다: ${spec.dict}`);
      this._rec.set(id, { session, dict });
    }
    if (this._rec.size === 0) throw new Error('사용할 OCR 인식 모델이 없습니다.');
  }

  /**
   * @param {Uint8Array} rgb
   * @param {number} width
   * @param {number} height
   * @returns {Promise<OcrLine[]>}
   */
  async recognizePage(rgb, width, height) {
    if (width < DET_MIN_SIZE || height < DET_MIN_SIZE) return [];
    const boxes = await this._detect(rgb, width, height);
    /** @type {OcrLine[]} */
    const items = [];
    for (const [x, y, w, h] of boxes) {
      const line = await this._recognizeLine(rgb, width, height, x, y, w, h);
      if (!line || !line.text.trim()) continue;
      if (line.conf >= TEXT_SCORE) items.push(line);
    }
    return dedupLines(items);
  }

  /**
   * @param {Uint8Array} rgb
   * @param {number} width
   * @param {number} height
   */
  async _detect(rgb, width, height) {
    const ratio = DET_LONG_SIDE / Math.max(width, height);
    const detW = Math.max(32, Math.round((width * ratio) / 32) * 32);
    const detH = Math.max(32, Math.round((height * ratio) / 32) * 32);
    const resized = await resizeRgb(rgb, width, height, detW, detH);
    const tensor = new Float32Array(1 * 3 * detH * detW);
    for (let y = 0; y < detH; y += 1) {
      for (let x = 0; x < detW; x += 1) {
        const i = (y * detW + x) * 3;
        const r = resized[i] / 255;
        const g = resized[i + 1] / 255;
        const b = resized[i + 2] / 255;
        // BGR 채널 순서로 Tiny 와 맞춤
        tensor[0 * detH * detW + y * detW + x] = (b - DET_MEAN[0]) / DET_STD[0];
        tensor[1 * detH * detW + y * detW + x] = (g - DET_MEAN[1]) / DET_STD[1];
        tensor[2 * detH * detW + y * detW + x] = (r - DET_MEAN[2]) / DET_STD[2];
      }
    }
    const inputName = this._det.inputNames[0];
    const outputName = this._det.outputNames[0];
    const feeds = { [inputName]: new ort.Tensor('float32', tensor, [1, 3, detH, detW]) };
    const out = await this._det.run(feeds);
    const probTensor = out[outputName];
    const prob = Float32Array.from(probTensor.data);
    // 출력 shape 이 [1,1,H,W] 또는 [1,H,W] 일 수 있음
    const flat = prob.length === detW * detH ? prob : prob.subarray(prob.length - detW * detH);
    const raw = componentBoxes(flat, detW, detH);
    const sx = width / detW;
    const sy = height / detH;
    /** @type {[number, number, number, number][]} */
    const boxes = [];
    for (const [x1, y1, x2, y2] of raw.slice(0, DET_MAX_BOXES)) {
      const bw = x2 - x1 + 1;
      const bh = y2 - y1 + 1;
      const delta = (bw * bh * DET_UNCLIP_RATIO) / (2 * (bw + bh));
      const px1 = Math.max(0, Math.floor((x1 - delta) * sx));
      const py1 = Math.max(0, Math.floor((y1 - delta) * sy));
      const px2 = Math.min(width, Math.ceil((x2 + 1 + delta) * sx));
      const py2 = Math.min(height, Math.ceil((y2 + 1 + delta) * sy));
      if (px2 - px1 < DET_MIN_SIZE || py2 - py1 < DET_MIN_SIZE) continue;
      boxes.push([px1, py1, px2 - px1, py2 - py1]);
    }
    return boxes;
  }

  /**
   * @param {Uint8Array} rgb
   * @param {number} width
   * @param {number} height
   * @param {number} x
   * @param {number} y
   * @param {number} w
   * @param {number} h
   */
  async _recognizeLine(rgb, width, height, x, y, w, h) {
    const crop = new Uint8Array(w * h * 3);
    for (let row = 0; row < h; row += 1) {
      const src = ((y + row) * width + x) * 3;
      crop.set(rgb.subarray(src, src + w * 3), row * w * 3);
    }
    const recW = Math.min(REC_MAX_WIDTH, Math.max(16, Math.round((w * REC_HEIGHT) / Math.max(h, 1))));
    const padded = Math.max(REC_MIN_WIDTH, recW);
    const resized = await resizeRgb(crop, w, h, recW, REC_HEIGHT);

    /** @type {OcrLine | null} */
    let best = null;
    for (const [, { session, dict }] of this._rec) {
      const tensor = new Float32Array(1 * 3 * REC_HEIGHT * padded);
      for (let row = 0; row < REC_HEIGHT; row += 1) {
        for (let col = 0; col < recW; col += 1) {
          const i = (row * recW + col) * 3;
          const r = resized[i] / 255 / 0.5 - 1;
          const g = resized[i + 1] / 255 / 0.5 - 1;
          const b = resized[i + 2] / 255 / 0.5 - 1;
          tensor[0 * REC_HEIGHT * padded + row * padded + col] = b;
          tensor[1 * REC_HEIGHT * padded + row * padded + col] = g;
          tensor[2 * REC_HEIGHT * padded + row * padded + col] = r;
        }
      }
      const inputName = session.inputNames[0];
      const outputName = session.outputNames[0];
      const feeds = { [inputName]: new ort.Tensor('float32', tensor, [1, 3, REC_HEIGHT, padded]) };
      const out = await session.run(feeds);
      const logits = out[outputName];
      const dims = logits.dims;
      // [1, T, C] 또는 [1, C, T]
      let timeSteps;
      let classes;
      let data = Float32Array.from(logits.data);
      if (dims.length === 3 && dims[1] > dims[2]) {
        // [1, C, T] → transpose to [T, C]
        classes = dims[1];
        timeSteps = dims[2];
        const transposed = new Float32Array(timeSteps * classes);
        for (let t = 0; t < timeSteps; t += 1) {
          for (let c = 0; c < classes; c += 1) {
            transposed[t * classes + c] = data[c * timeSteps + t];
          }
        }
        data = transposed;
      } else {
        timeSteps = dims[1];
        classes = dims[2];
      }
      const decoded = ctcDecode(data, timeSteps, classes, dict);
      if (!decoded) continue;
      if (!best || decoded.conf > best.conf) {
        best = { text: decoded.text, x, y, w, h, conf: decoded.conf };
      }
    }
    return best;
  }
}

/** @type {Map<string, Promise<OcrEngine>>} */
const engineCache = new Map();

/**
 * @param {string[]} recModelIds
 * @param {(message: string) => void} [onLog]
 */
export async function getOcrEngine(recModelIds, onLog) {
  const ids = [...new Set(recModelIds.length ? recModelIds : ['korean'])].sort();
  const folder = await ensureModels(ids, onLog);
  const key = `${folder}|${ids.join(',')}`;
  if (!engineCache.has(key)) {
    engineCache.set(
      key,
      (async () => {
        const engine = new OcrEngine(folder, ids);
        await engine.init();
        return engine;
      })(),
    );
  }
  return engineCache.get(key);
}

export function resetOcrEngineCache() {
  engineCache.clear();
}
