import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  effectiveDurationSec,
  estimateGifBytes,
  formatOriginalRelativeEstimate,
} from '../shared/sizePresets.js';
import { normalizeOptions } from './converters/videoToGif.js';
import { probeMediaFile, resolveFfmpegBinary, runFfmpeg } from './ffmpegService.js';

/**
 * Clips at or under this length are estimated with a full encode (exact size).
 * Longer clips use a mid-roll sample + dampened extrapolation.
 */
const EXACT_THRESHOLD_SEC = 15;
/** Sample length for long clips. */
const LONG_SAMPLE_SEC = 3;
/**
 * GIF size does not grow linearly with duration (shared palette + LZW).
 * Apply sub-linear exponent when extrapolating a short sample to a long clip.
 */
const EXTRAPOLATE_EXPONENT = 0.72;

/**
 * @param {ReturnType<typeof normalizeOptions>} options
 * @param {'palette' | 'encode'} stage
 */
function buildFilter(options, stage) {
  const scale = `fps=${options.fps},scale=${options.width}:-1:flags=lanczos`;
  if (stage === 'palette') return `${scale},palettegen=stats_mode=diff`;
  return `${scale}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5`;
}

/**
 * @param {{
 *   ffmpegPath: string,
 *   inputPath: string,
 *   seekSec: number,
 *   sampleDur: number,
 *   opts: ReturnType<typeof normalizeOptions>,
 *   signal?: AbortSignal,
 * }} args
 */
async function encodeSampleGif({ ffmpegPath, inputPath, seekSec, sampleDur, opts, signal }) {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vti-est-'));
  const palettePath = path.join(workDir, 'palette.png');
  const gifPath = path.join(workDir, 'sample.gif');

  const commonIn = [];
  const seek = Math.max(0, seekSec);
  if (seek > 0) commonIn.push('-ss', String(seek));
  commonIn.push('-i', inputPath);
  commonIn.push('-t', String(sampleDur));

  try {
    const pass1 = await runFfmpeg(
      ffmpegPath,
      [...commonIn, '-vf', buildFilter({ ...opts, durationSec: sampleDur }, 'palette'), '-y', palettePath],
      { signal },
    );
    if (pass1.code !== 0) throw new Error(pass1.stderr.trim().slice(-200) || 'palette failed');

    const pass2 = await runFfmpeg(
      ffmpegPath,
      [
        ...commonIn,
        '-i',
        palettePath,
        '-lavfi',
        buildFilter({ ...opts, durationSec: sampleDur }, 'encode'),
        '-y',
        gifPath,
      ],
      { signal },
    );
    if (pass2.code !== 0) throw new Error(pass2.stderr.trim().slice(-200) || 'encode failed');
    if (!fs.existsSync(gifPath)) throw new Error('sample gif missing');
    return fs.statSync(gifPath).size;
  } finally {
    try {
      fs.rmSync(workDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}

/**
 * Encode a sample GIF with the same filters as full conversion.
 * - duration ≤ 15s: encode the whole clip → exact size
 * - longer: 3s from the middle, then sub-linear extrapolation
 *
 * @param {{
 *   inputPath: string,
 *   options?: Record<string, unknown>,
 *   media?: import('./ffmpegService.js').MediaProbeInfo,
 *   signal?: AbortSignal,
 * }} args
 */
export async function estimateGifSizeFromSample({ inputPath, options, media, signal }) {
  const resolved = path.resolve(String(inputPath ?? '').trim());
  const probe = media?.ok ? media : await probeMediaFile(resolved);
  if (!probe.ok) {
    return {
      path: resolved,
      ok: false,
      method: 'none',
      originalBytes: probe.fileSize || 0,
      estimatedBytes: 0,
      sampleBytes: 0,
      sampleDur: 0,
      fullDur: 0,
      error: probe.error || '미디어 정보를 읽지 못했습니다.',
    };
  }

  const opts = normalizeOptions(options);
  const fullDur = effectiveDurationSec({
    mediaDurationSec: probe.durationSec,
    startSec: opts.startSec,
    durationSec: opts.durationSec,
  });
  if (fullDur <= 0) {
    return {
      path: resolved,
      ok: false,
      method: 'none',
      originalBytes: probe.fileSize,
      estimatedBytes: 0,
      sampleBytes: 0,
      sampleDur: 0,
      fullDur: 0,
      error: '변환할 구간 길이가 없습니다.',
    };
  }

  const exact = fullDur <= EXACT_THRESHOLD_SEC;
  const sampleDur = exact ? fullDur : Math.min(LONG_SAMPLE_SEC, fullDur);
  // Mid-roll sample for long clips (start is often atypical: titles, motion).
  const seekSec = exact
    ? opts.startSec
    : opts.startSec + Math.max(0, (fullDur - sampleDur) / 2);

  let estimatedBytes = 0;
  let sampleBytes = 0;
  /** @type {'sample' | 'sample-exact' | 'formula'} */
  let method = exact ? 'sample-exact' : 'sample';

  try {
    if (signal?.aborted) throw new Error('cancelled');
    const { path: ffmpegPath } = resolveFfmpegBinary();
    sampleBytes = await encodeSampleGif({
      ffmpegPath,
      inputPath: resolved,
      seekSec,
      sampleDur,
      opts,
      signal,
    });

    if (exact || sampleDur >= fullDur) {
      estimatedBytes = sampleBytes;
      method = 'sample-exact';
    } else {
      const ratio = fullDur / sampleDur;
      estimatedBytes = Math.max(1, Math.round(sampleBytes * ratio ** EXTRAPOLATE_EXPONENT));
    }
  } catch (err) {
    if (signal?.aborted || (err instanceof Error && /cancel/i.test(err.message))) {
      return {
        path: resolved,
        ok: false,
        method: 'none',
        originalBytes: probe.fileSize,
        estimatedBytes: 0,
        sampleBytes: 0,
        sampleDur,
        fullDur,
        error: 'cancelled',
      };
    }
    method = 'formula';
    estimatedBytes = estimateGifBytes({
      fps: opts.fps,
      width: opts.width,
      durationSec: fullDur,
      sourceWidth: probe.width,
      sourceHeight: probe.height,
    });
  }

  return {
    path: resolved,
    ok: estimatedBytes > 0,
    method,
    originalBytes: probe.fileSize,
    estimatedBytes,
    sampleBytes,
    sampleDur,
    fullDur,
    width: probe.width,
    height: probe.height,
  };
}

/**
 * Estimate for one or more inputs (sequential samples).
 * @param {{
 *   paths: string[],
 *   options?: Record<string, unknown>,
 *   signal?: AbortSignal,
 * }} args
 */
export async function estimateGifSizeBatch({ paths, options, signal }) {
  /** @type {Awaited<ReturnType<typeof estimateGifSizeFromSample>>[]} */
  const items = [];
  let originalBytes = 0;
  let estimatedBytes = 0;
  let sampleCount = 0;
  let formulaCount = 0;

  for (const p of paths) {
    if (signal?.aborted) break;
    const item = await estimateGifSizeFromSample({ inputPath: p, options, signal });
    items.push(item);
    if (!item.ok) continue;
    originalBytes += item.originalBytes;
    estimatedBytes += item.estimatedBytes;
    if (item.method === 'sample' || item.method === 'sample-exact') sampleCount += 1;
    else if (item.method === 'formula') formulaCount += 1;
  }

  const method = sampleCount > 0 ? 'sample' : formulaCount > 0 ? 'formula' : 'none';
  const allExact = items.length > 0 && items.every((i) => !i.ok || i.method === 'sample-exact');
  return {
    ok: estimatedBytes > 0 && originalBytes > 0,
    method: allExact && sampleCount > 0 ? 'sample-exact' : method,
    originalBytes,
    estimatedBytes,
    items,
    label: formatOriginalRelativeEstimate({ estimatedBytes, originalBytes }),
  };
}
