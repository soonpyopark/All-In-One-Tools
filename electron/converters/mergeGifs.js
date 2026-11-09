import fs from 'node:fs';
import path from 'node:path';
import { parseFfmpegTimeSeconds, probeMediaFile, runFfmpeg } from '../ffmpegService.js';

const INPUT_EXTS = ['.gif'];

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
  return {
    fps: clampNumber(src.fps, 1, 60, 10),
    speed: clampNumber(src.speed, 0.1, 8, 1),
  };
}

/**
 * @param {number} n
 * @param {number} maxW
 * @param {number} maxH
 * @param {number} speed
 * @param {number} fps
 */
function buildFilterComplex(n, maxW, maxH, speed, fps) {
  /** @type {string[]} */
  const parts = [];
  for (let i = 0; i < n; i += 1) {
    parts.push(
      `[${i}:v]scale=${maxW}:${maxH}:force_original_aspect_ratio=decrease,` +
        `pad=${maxW}:${maxH}:(ow-iw)/2:(oh-ih)/2,` +
        `setpts=PTS/${speed},setsar=1[v${i}]`,
    );
  }
  const ins = Array.from({ length: n }, (_, i) => `[v${i}]`).join('');
  parts.push(`${ins}concat=n=${n}:v=1[vcat]`);
  parts.push(`[vcat]fps=fps=${fps}:round=up[vfps]`);
  parts.push('[vfps]split[s0][s1];[s0]palettegen=stats_mode=diff[p];[s1][p]paletteuse[out]');
  return parts.join(';');
}

/** @type {import('./registry.js').ConverterDefinition} */
export const mergeGifs = {
  id: 'merge-gifs',
  label: 'GIF 이어붙이기',
  description: '여러 GIF를 순서대로 이어 붙여 하나의 GIF로 만듭니다. (해상도는 가장 큰 칸에 맞춤)',
  inputExts: INPUT_EXTS,
  outputExt: '.gif',
  optionProfile: 'merge-gifs',
  jobMode: 'merge',
  minInputs: 2,
  defaultOptions: normalizeOptions({ fps: 10, speed: 1 }),
  normalizeOptions,
  async run({ ffmpegPath, inputPath, inputPaths, outputPath, options, signal, onProgress }) {
    const opts = normalizeOptions(options);
    const paths = (Array.isArray(inputPaths) && inputPaths.length > 0 ? inputPaths : [inputPath])
      .map((p) => path.resolve(String(p ?? '').trim()))
      .filter(Boolean);

    if (paths.length === 0) throw new Error('합칠 GIF 파일이 없습니다.');
    for (const p of paths) {
      if (!fs.existsSync(p) || !fs.statSync(p).isFile()) {
        throw new Error(`입력 파일을 찾을 수 없습니다.\n${p}`);
      }
      const ext = path.extname(p).toLowerCase();
      if (!INPUT_EXTS.includes(ext)) {
        throw new Error(`지원하지 않는 형식입니다 (${ext || '확장자 없음'}).\n${p}`);
      }
    }

    /** @type {number[]} */
    const widths = [];
    /** @type {number[]} */
    const heights = [];
    let totalDuration = 0;
    for (const p of paths) {
      const probe = await probeMediaFile(p);
      if (!probe.ok || !(probe.width > 0) || !(probe.height > 0)) {
        throw new Error(probe.error || `해상도를 읽지 못했습니다.\n${p}`);
      }
      widths.push(probe.width);
      heights.push(probe.height);
      if (probe.durationSec > 0) totalDuration += probe.durationSec;
    }

    const maxW = Math.max(...widths);
    const maxH = Math.max(...heights);
    const filterComplex = buildFilterComplex(paths.length, maxW, maxH, opts.speed, opts.fps);
    const estimated = totalDuration > 0 ? totalDuration / opts.speed : null;

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    onProgress?.(0.02);

    /** @type {string[]} */
    const args = ['-y'];
    for (const p of paths) {
      args.push('-i', p);
    }
    args.push('-filter_complex', filterComplex, '-map', '[out]', outputPath);

    const result = await runFfmpeg(ffmpegPath, args, {
      signal,
      onStderr: (chunk) => {
        if (!onProgress || estimated == null) return;
        const t = parseFfmpegTimeSeconds(chunk);
        if (t == null) return;
        onProgress(Math.min(0.99, Math.max(0.02, t / estimated)));
      },
    });

    if (result.code !== 0) {
      throw new Error(
        result.stderr.trim().split(/\r?\n/).slice(-8).join('\n') || 'GIF 이어붙이기에 실패했습니다.',
      );
    }
    if (!fs.existsSync(outputPath)) throw new Error('출력 파일이 생성되지 않았습니다.');
    onProgress?.(1);
  },
};
