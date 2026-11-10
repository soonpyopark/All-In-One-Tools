import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { statePath } from '../context.js';
import { readJsonSync, withFileLock, writeJsonSync } from '../jsonStore.js';

/**
 * 캡처 매크로 프리셋 저장소 (`macros.json`).
 *
 * @typedef {{ x: number, y: number, width: number, height: number }} Region
 * @typedef {{
 *   mode: 'screen' | 'window' | 'region',
 *   displayId: number | null,
 *   windowTitle: string,
 *   region: Region | null,
 * }} CaptureTarget
 * @typedef {
 *   | { type: 'delay', ms: number }
 *   | { type: 'key', action: 'press' | 'down' | 'up', key: string }
 *   | { type: 'mouse', action: 'move' | 'click' | 'double' | 'down' | 'up' | 'scroll', button: 'left' | 'middle' | 'right', x: number, y: number, amount: number }
 *   | { type: 'capture', target: CaptureTarget }
 * } MacroStep
 * @typedef {{
 *   id: string,
 *   name: string,
 *   startKey: string,
 *   stopKey: string,
 *   repeat: number,
 *   outputDir: string,
 *   format: 'png' | 'jpg',
 *   jpegQuality: number,
 *   detectSame: boolean,
 *   changeTimeoutMs: number,
 *   resendOnTimeout: boolean,
 *   sameThreshold: number,
 *   hideApp: boolean,
 *   startDelayMs: number,
 *   steps: MacroStep[],
 * }} MacroPreset
 */

const MACROS_FILE = 'macros.json';
const MAX_PRESETS = 100;
const MAX_STEPS = 500;

const KEY_NAME = /^[A-Za-z][A-Za-z0-9]{0,15}$/;
const ACCELERATOR = /^(?:(?:Ctrl|Alt|Shift|Super)\+)*[^+\s]{1,16}$/;

/** @param {unknown} value @param {number} min @param {number} max @param {number} fallback */
function clampInt(value, min, max, fallback) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** @param {unknown} value @param {number} min @param {number} max @param {number} fallback */
function clampFloat(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** @param {unknown} value @param {string[]} allowed @param {string} fallback */
function pick(value, allowed, fallback) {
  const text = String(value ?? '');
  return allowed.includes(text) ? text : fallback;
}

/** @param {any} raw @returns {Region | null} */
function normalizeRegion(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const width = clampInt(raw.width, 0, 100000, 0);
  const height = clampInt(raw.height, 0, 100000, 0);
  if (width < 1 || height < 1) return null;
  return {
    x: clampInt(raw.x, -100000, 100000, 0),
    y: clampInt(raw.y, -100000, 100000, 0),
    width,
    height,
  };
}

/** @param {any} raw @returns {CaptureTarget} */
export function normalizeTarget(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const displayId = Number(src.displayId);
  return {
    mode: /** @type {CaptureTarget['mode']} */ (pick(src.mode, ['screen', 'window', 'region'], 'screen')),
    displayId: Number.isFinite(displayId) && src.displayId !== null && src.displayId !== '' ? displayId : null,
    windowTitle: String(src.windowTitle ?? '').trim().slice(0, 200),
    region: normalizeRegion(src.region),
  };
}

/** @param {any} raw @returns {MacroStep | null} */
function normalizeStep(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.type === 'delay') {
    return { type: 'delay', ms: clampInt(raw.ms, 0, 3_600_000, 500) };
  }
  if (raw.type === 'key') {
    const key = String(raw.key ?? '').trim();
    if (!KEY_NAME.test(key)) return null;
    return { type: 'key', action: /** @type {'press' | 'down' | 'up'} */ (pick(raw.action, ['press', 'down', 'up'], 'press')), key };
  }
  if (raw.type === 'mouse') {
    return {
      type: 'mouse',
      action: /** @type {any} */ (pick(raw.action, ['move', 'click', 'double', 'down', 'up', 'scroll'], 'click')),
      button: /** @type {any} */ (pick(raw.button, ['left', 'middle', 'right'], 'left')),
      x: clampInt(raw.x, -100000, 100000, 0),
      y: clampInt(raw.y, -100000, 100000, 0),
      amount: clampInt(raw.amount, -100, 100, 3),
    };
  }
  if (raw.type === 'capture') {
    return { type: 'capture', target: normalizeTarget(raw.target) };
  }
  return null;
}

/** @param {unknown} value @param {string} fallback */
function normalizeAccelerator(value, fallback) {
  const text = String(value ?? '').trim();
  return ACCELERATOR.test(text) ? text : fallback;
}

/**
 * 디스크/API 에서 온 값을 올바른 프리셋으로 바꿉니다.
 * @param {any} raw
 * @returns {MacroPreset}
 */
export function normalizePreset(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const steps = (Array.isArray(src.steps) ? src.steps : [])
    .slice(0, MAX_STEPS)
    .map(normalizeStep)
    .filter((step) => step !== null);
  return {
    id: typeof src.id === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(src.id) ? src.id : randomUUID(),
    name: String(src.name ?? '').trim().slice(0, 60) || '새 매크로',
    startKey: normalizeAccelerator(src.startKey, 'F6'),
    stopKey: normalizeAccelerator(src.stopKey, 'F7'),
    repeat: clampInt(src.repeat, 0, 1_000_000, 1),
    outputDir: String(src.outputDir ?? '').trim(),
    format: src.format === 'jpg' ? 'jpg' : 'png',
    jpegQuality: clampInt(src.jpegQuality, 10, 100, 90),
    // 같은 화면 감지: 예전 프리셋의 `stopOnSame`(0 이면 사용 안 함)을 이어받습니다.
    detectSame: typeof src.detectSame === 'boolean' ? src.detectSame : clampInt(src.stopOnSame, 0, 100, 3) > 0,
    // 같은 화면이면 입력을 다시 보내지 않고 화면이 바뀔 때까지 기다리는 최대 시간
    changeTimeoutMs: clampInt(src.changeTimeoutMs, 1000, 600_000, 15_000),
    // 최대 시간이 지나도 안 바뀔 때 넘기는 동작을 한 번만 다시 보낼지 (느린 뷰어에서는 페이지를 건너뛸 수 있어 기본 꺼짐)
    resendOnTimeout: src.resendOnTimeout === true,
    // 같은 화면 판단 기준: 바뀐 픽셀이 이 비율(%)보다 적으면 같은 화면으로 봅니다.
    sameThreshold: clampFloat(src.sameThreshold, 0.0001, 50, 0.0001),
    hideApp: src.hideApp !== false,
    startDelayMs: clampInt(src.startDelayMs, 0, 60_000, 1000),
    steps: /** @type {MacroStep[]} */ (steps),
  };
}

/** 앱에 포함된 기본 프리셋 (`defaultPresets.json`). 읽지 못하면 빈 목록입니다. @returns {MacroPreset[]} */
function loadDefaultPresets() {
  try {
    const file = path.join(path.dirname(fileURLToPath(import.meta.url)), 'defaultPresets.json');
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    return (Array.isArray(raw?.presets) ? raw.presets : []).map(normalizePreset);
  } catch {
    return [];
  }
}

/** @returns {MacroPreset[]} */
export function listPresets() {
  const file = statePath(MACROS_FILE);
  // 처음 실행해 프리셋 파일이 아직 없으면 기본 프리셋으로 시작합니다. (사용자가 모두 지운 경우에는 다시 넣지 않음)
  if (!fs.existsSync(file)) {
    const defaults = loadDefaultPresets();
    if (defaults.length > 0) {
      try {
        writePresets(defaults);
      } catch {
        // 저장하지 못해도 이번 실행에는 기본 프리셋을 보여 줍니다.
      }
      return defaults;
    }
  }
  const raw = readJsonSync(file, { presets: [] });
  const seen = new Set();
  /** @type {MacroPreset[]} */
  const presets = [];
  for (const item of Array.isArray(raw?.presets) ? raw.presets : []) {
    const preset = normalizePreset(item);
    if (seen.has(preset.id)) continue;
    seen.add(preset.id);
    presets.push(preset);
    if (presets.length >= MAX_PRESETS) break;
  }
  return presets;
}

/** @param {string} id @returns {MacroPreset | null} */
export function getPreset(id) {
  return listPresets().find((preset) => preset.id === id) ?? null;
}

/** @param {MacroPreset[]} presets */
function writePresets(presets) {
  writeJsonSync(statePath(MACROS_FILE), { version: 1, presets });
}

/** 있으면 갱신하고, 없으면 끝에 추가합니다. @param {any} raw */
export function savePreset(raw) {
  return withFileLock(statePath(MACROS_FILE), () => {
    const preset = normalizePreset(raw);
    const presets = listPresets();
    const index = presets.findIndex((item) => item.id === preset.id);
    if (index >= 0) presets[index] = preset;
    else if (presets.length >= MAX_PRESETS) throw new Error(`프리셋은 최대 ${MAX_PRESETS}개까지 저장할 수 있습니다.`);
    else presets.push(preset);
    writePresets(presets);
    return preset;
  });
}

/** @param {string} id */
export function removePreset(id) {
  return withFileLock(statePath(MACROS_FILE), () => {
    const presets = listPresets().filter((item) => item.id !== id);
    writePresets(presets);
    return presets;
  });
}

/** @param {string} id @param {number} direction -1 위로, 1 아래로 */
export function movePreset(id, direction) {
  return withFileLock(statePath(MACROS_FILE), () => {
    const presets = listPresets();
    const index = presets.findIndex((item) => item.id === id);
    const next = index + (direction < 0 ? -1 : 1);
    if (index < 0 || next < 0 || next >= presets.length) return presets;
    const [item] = presets.splice(index, 1);
    presets.splice(next, 0, item);
    writePresets(presets);
    return presets;
  });
}
