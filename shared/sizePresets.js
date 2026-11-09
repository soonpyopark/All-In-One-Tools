/**
 * GIF 용량(품질) 프리셋. 선택 시 FPS·너비에 반영됩니다.
 * hint 는 UI 안내용이며 실제 용량을 보장하지는 않습니다.
 *
 * @typedef {{
 *   id: string,
 *   label: string,
 *   hint: string,
 *   fps: number,
 *   width: number,
 * }} SizePreset
 */

/** @type {SizePreset[]} */
export const SIZE_PRESETS = [
  {
    id: 'tiny',
    label: '매우 작음',
    hint: '메신저·미리보기용 · 용량 최소',
    fps: 6,
    width: 240,
  },
  {
    id: 'small',
    label: '작음',
    hint: '가벼운 공유용',
    fps: 8,
    width: 320,
  },
  {
    id: 'medium',
    label: '보통',
    hint: '균형 잡힌 기본값',
    fps: 10,
    width: 480,
  },
  {
    id: 'large',
    label: '큼',
    hint: '선명도 우선',
    fps: 12,
    width: 640,
  },
  {
    id: 'xlarge',
    label: '매우 큼',
    hint: '고품질 · 용량 큼',
    fps: 15,
    width: 720,
  },
];

export const DEFAULT_SIZE_PRESET_ID = 'medium';

/**
 * Fallback bytes/pixel/frame when sample encode is unavailable.
 * Tuned down for palette GIF (lanczos + bayer); sample encode is preferred.
 */
export const GIF_BYTES_PER_PIXEL = 0.04;

/** @param {string} [id] */
export function getSizePreset(id) {
  return SIZE_PRESETS.find((p) => p.id === id) ?? null;
}

/**
 * Match a preset by fps+width, or null if custom.
 * @param {number} fps
 * @param {number} width
 */
export function matchSizePreset(fps, width) {
  return SIZE_PRESETS.find((p) => p.fps === fps && p.width === width) ?? null;
}

/**
 * Clip duration used for conversion / estimates.
 * @param {{
 *   mediaDurationSec: number,
 *   startSec?: number,
 *   durationSec?: number | null,
 * }} args
 */
export function effectiveDurationSec({ mediaDurationSec, startSec = 0, durationSec = null }) {
  const media = Math.max(0, Number(mediaDurationSec) || 0);
  const start = Math.max(0, Number(startSec) || 0);
  const remain = Math.max(0, media - start);
  if (remain <= 0) return 0;
  if (durationSec == null || durationSec === '' || !Number.isFinite(Number(durationSec))) {
    return remain;
  }
  return Math.min(remain, Math.max(0.1, Number(durationSec)));
}

/**
 * Estimate output GIF bytes from encode settings + source geometry.
 * @param {{
 *   fps: number,
 *   width: number,
 *   durationSec: number,
 *   sourceWidth?: number,
 *   sourceHeight?: number,
 * }} args
 */
export function estimateGifBytes({ fps, width, durationSec, sourceWidth, sourceHeight }) {
  const f = Math.max(0.1, Number(fps) || 0);
  const tw = Math.max(1, Number(width) || 0);
  const dur = Math.max(0, Number(durationSec) || 0);
  if (dur <= 0 || tw <= 0 || f <= 0) return 0;

  const sw = Math.max(1, Number(sourceWidth) || tw);
  const sh = Math.max(1, Number(sourceHeight) || Math.round((tw * 9) / 16));
  const scale = Math.min(1, tw / sw);
  const outW = Math.max(1, Math.round(sw * scale));
  const outH = Math.max(1, Math.round(sh * scale));
  const frames = f * dur;
  return Math.max(1, Math.round(frames * outW * outH * GIF_BYTES_PER_PIXEL));
}

/** @param {number} bytes */
export function formatBytes(bytes) {
  const n = Math.max(0, Number(bytes) || 0);
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * @param {{ estimatedBytes: number, originalBytes: number }} args
 * @returns {string}
 */
export function formatOriginalRelativeEstimate({ estimatedBytes, originalBytes }) {
  const est = Math.max(0, Number(estimatedBytes) || 0);
  const orig = Math.max(0, Number(originalBytes) || 0);
  if (est <= 0 || orig <= 0) return '';

  const pctOfOriginal = Math.round((est / orig) * 100);
  const reduction = Math.max(0, Math.round((1 - est / orig) * 100));
  if (est >= orig) {
    return `원본 ${formatBytes(orig)} → 예상 약 ${formatBytes(est)} (원본보다 큼 · 추정)`;
  }
  return `원본 ${formatBytes(orig)} → 예상 약 ${formatBytes(est)} (약 ${pctOfOriginal}%, ${reduction}% 감소 · 추정)`;
}

/**
 * Short label for preset dropdown, e.g. "~18%" of original.
 * @param {{ estimatedBytes: number, originalBytes: number }} args
 */
export function formatOriginalPercentLabel({ estimatedBytes, originalBytes }) {
  const est = Math.max(0, Number(estimatedBytes) || 0);
  const orig = Math.max(0, Number(originalBytes) || 0);
  if (est <= 0 || orig <= 0) return '';
  const pct = Math.round((est / orig) * 100);
  if (pct >= 100) return `원본↑`;
  return `원본 ~${pct}%`;
}
