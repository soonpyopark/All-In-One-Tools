import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_SIZE_PRESET_ID, SIZE_PRESETS, getSizePreset } from '../../shared/sizePresets.js';
import { parseFfmpegTimeSeconds, runFfmpeg } from '../ffmpegService.js';

const INPUT_EXTS = ['.mp4', '.mov', '.mkv', '.webm', '.avi', '.m4v', '.wmv', '.mpeg', '.mpg'];
const DEFAULT_PRESET = getSizePreset(DEFAULT_SIZE_PRESET_ID) ?? SIZE_PRESETS[2];

/**
 * @param {unknown} value
 * @param {number} min
 * @param {number} max
 * @param {number} fallback
 */
function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * @param {Record<string, unknown>} [raw]
 */
export function normalizeOptions(raw = {}) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const durationRaw = src.durationSec;
  const durationSec =
    durationRaw === null || durationRaw === undefined || durationRaw === ''
      ? null
      : clampNumber(durationRaw, 0.1, 3600, null);

  return {
    fps: clampNumber(src.fps, 1, 30, DEFAULT_PRESET.fps),
    width: clampNumber(src.width, 32, 1920, DEFAULT_PRESET.width),
    startSec: clampNumber(src.startSec, 0, 3600 * 24, 0),
    durationSec,
  };
}

/**
 * @param {ReturnType<typeof normalizeOptions>} options
 * @param {'palette' | 'encode'} stage
 */
function buildFilter(options, stage) {
  const scale = `fps=${options.fps},scale=${options.width}:-1:flags=lanczos`;
  if (stage === 'palette') return `${scale},palettegen=stats_mode=diff`;
  return `${scale}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5`;
}

/** @type {import('./registry.js').ConverterDefinition} */
export const videoToGif = {
  id: 'video-to-gif',
  label: '동영상 → GIF',
  description: 'mp4 등 동영상을 GIF로 변환합니다 (palette 2-pass).',
  inputExts: INPUT_EXTS,
  outputExt: '.gif',
  optionProfile: 'gif',
  defaultPresetId: DEFAULT_SIZE_PRESET_ID,
  sizePresets: SIZE_PRESETS,
  defaultOptions: normalizeOptions({
    fps: DEFAULT_PRESET.fps,
    width: DEFAULT_PRESET.width,
  }),
  normalizeOptions,
  async run({ ffmpegPath, inputPath, outputPath, options, signal, onProgress }) {
    const opts = normalizeOptions(options);
    const estimated =
      opts.durationSec && opts.durationSec > 0
        ? opts.durationSec
        : null;

    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vti-gif-'));
    const palettePath = path.join(workDir, 'palette.png');

    const commonIn = [];
    if (opts.startSec > 0) commonIn.push('-ss', String(opts.startSec));
    commonIn.push('-i', inputPath);
    if (opts.durationSec != null) commonIn.push('-t', String(opts.durationSec));

    const report = (chunk, weight, offset) => {
      if (!onProgress || estimated == null) return;
      const t = parseFfmpegTimeSeconds(chunk);
      if (t == null) return;
      const ratio = Math.min(1, Math.max(0, t / estimated));
      onProgress(Math.min(0.99, offset + ratio * weight));
    };

    try {
      onProgress?.(0.02);
      const pass1 = await runFfmpeg(
        ffmpegPath,
        [...commonIn, '-vf', buildFilter(opts, 'palette'), '-y', palettePath],
        {
          signal,
          onStderr: (chunk) => report(chunk, 0.35, 0.05),
        },
      );
      if (pass1.code !== 0) {
        throw new Error(pass1.stderr.trim().split(/\r?\n/).slice(-6).join('\n') || 'palette 생성에 실패했습니다.');
      }

      onProgress?.(0.4);
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      const pass2 = await runFfmpeg(
        ffmpegPath,
        [
          ...commonIn,
          '-i',
          palettePath,
          '-lavfi',
          buildFilter(opts, 'encode'),
          '-y',
          outputPath,
        ],
        {
          signal,
          onStderr: (chunk) => report(chunk, 0.55, 0.4),
        },
      );
      if (pass2.code !== 0) {
        throw new Error(pass2.stderr.trim().split(/\r?\n/).slice(-6).join('\n') || 'GIF 인코딩에 실패했습니다.');
      }
      if (!fs.existsSync(outputPath)) throw new Error('출력 파일이 생성되지 않았습니다.');
      onProgress?.(1);
    } finally {
      try {
        fs.rmSync(workDir, { recursive: true, force: true });
      } catch {
        // ignore cleanup errors
      }
    }
  },
};
