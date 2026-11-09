import fs from 'node:fs';
import path from 'node:path';
import {
  LOUDNORM_I,
  LOUDNORM_LRA,
  LOUDNORM_TP,
  PITCH_MAX,
  PITCH_MIN,
  PITCH_ORIGINAL,
  PITCH_STAGES,
  VOLUME_MAX,
  VOLUME_MIN,
  VOLUME_ORIGINAL,
  VOLUME_STEP,
} from '../../shared/pitchVolume.js';
import {
  parseFfmpegTimeSeconds,
  probeMediaFile,
  resolveFfprobeBinary,
  runFfmpeg,
} from '../ffmpegService.js';

const INPUT_EXTS = ['.mp4', '.ts', '.mkv', '.mov', '.avi', '.webm', '.m4v', '.mp3'];

/** @type {boolean | null} */
let rubberbandCache = null;

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
 * @param {unknown} value
 * @param {number} step
 */
function snapToStep(value, step) {
  if (!Number.isFinite(value) || step <= 0) return value;
  return Math.round(value / step) * step;
}

/** @param {number} semitones */
function semitonesToFactor(semitones) {
  return 2 ** (semitones / 12);
}

/**
 * @param {Record<string, unknown>} [raw]
 */
export function normalizeOptions(raw = {}) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const stage = clampNumber(src.pitchStage ?? src.stage, PITCH_MIN, PITCH_MAX, PITCH_ORIGINAL);
  const volume = snapToStep(
    clampNumber(src.volume, VOLUME_MIN, VOLUME_MAX, VOLUME_ORIGINAL),
    VOLUME_STEP,
  );
  const outputFormat = src.outputFormat === 'mp3' ? 'mp3' : 'same';
  const normalizeLoudness = Boolean(src.normalizeLoudness);
  const matched = PITCH_STAGES.find((item) => item.stage === stage) ?? PITCH_STAGES[PITCH_ORIGINAL];
  return {
    pitchStage: matched.stage,
    semitones: matched.semitones,
    volume,
    outputFormat,
    normalizeLoudness,
  };
}

/**
 * @param {string} inputPath
 * @param {ReturnType<typeof normalizeOptions>} options
 */
export function resolveOutputExt(inputPath, options) {
  if (options.outputFormat === 'mp3') return '.mp3';
  const ext = path.extname(inputPath).toLowerCase();
  return INPUT_EXTS.includes(ext) ? ext : '.mp4';
}

/** @param {string} ffmpegPath */
async function hasRubberbandFilter(ffmpegPath) {
  if (rubberbandCache != null) return rubberbandCache;
  try {
    const result = await runFfmpeg(ffmpegPath, ['-filters']);
    const text = `${result.stdout}\n${result.stderr}`;
    rubberbandCache = /\brubberband\b/.test(text);
  } catch {
    rubberbandCache = false;
  }
  return rubberbandCache;
}

/**
 * @param {string} ffprobePath
 * @param {string} inputPath
 */
async function getAudioSampleRate(ffprobePath, inputPath) {
  const result = await runFfmpeg(ffprobePath, [
    '-v',
    'error',
    '-select_streams',
    'a:0',
    '-show_entries',
    'stream=sample_rate',
    '-of',
    'default=noprint_wrappers=1:nokey=1',
    inputPath,
  ]);
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || '오디오 샘플 레이트를 읽지 못했습니다.');
  }
  const rate = Number(String(result.stdout).trim());
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error('오디오 스트림을 찾을 수 없습니다.');
  }
  return rate;
}

/**
 * @param {string} ffprobePath
 * @param {string} inputPath
 */
async function hasVideoStream(ffprobePath, inputPath) {
  const result = await runFfmpeg(ffprobePath, [
    '-v',
    'error',
    '-select_streams',
    'v:0',
    '-show_entries',
    'stream=codec_type',
    '-of',
    'default=noprint_wrappers=1:nokey=1',
    inputPath,
  ]);
  return result.code === 0 && String(result.stdout).trim() === 'video';
}

/** @param {string} outputPath */
function outputCodecArgs(outputPath) {
  const ext = path.extname(outputPath).toLowerCase();
  if (ext === '.mp3') return ['-c:a', 'libmp3lame', '-b:a', '192k'];
  return ['-c:a', 'aac', '-b:a', '192k'];
}

/**
 * Pitch / tempo chain only (shared by measure + encode).
 * @param {number} sampleRate
 * @param {number} semitones
 * @param {boolean} useRubberband
 */
function buildPitchParts(sampleRate, semitones, useRubberband) {
  /** @type {string[]} */
  const parts = [];
  if (semitones === 0) return parts;
  const factor = semitonesToFactor(semitones);
  if (useRubberband) {
    parts.push(`rubberband=pitch=${factor.toFixed(6)}`);
  } else {
    const tempo = 1 / factor;
    parts.push(
      `asetrate=${sampleRate}*${factor.toFixed(6)},aresample=${sampleRate},atempo=${tempo.toFixed(6)}`,
    );
  }
  return parts;
}

/** @param {number} volume */
function buildVolumePart(volume) {
  if (volume <= 0) return 'volume=0';
  if (volume === VOLUME_ORIGINAL) return null;
  return `volume=${(volume / VOLUME_ORIGINAL).toFixed(4)}`;
}

function loudnormMeasureFilter() {
  return `loudnorm=I=${LOUDNORM_I}:TP=${LOUDNORM_TP}:LRA=${LOUDNORM_LRA}:print_format=json`;
}

/**
 * @param {{
 *   input_i: string,
 *   input_tp: string,
 *   input_lra: string,
 *   input_thresh: string,
 *   target_offset: string,
 * }} measured
 */
function loudnormApplyFilter(measured) {
  return [
    `loudnorm=I=${LOUDNORM_I}`,
    `TP=${LOUDNORM_TP}`,
    `LRA=${LOUDNORM_LRA}`,
    `measured_I=${measured.input_i}`,
    `measured_LRA=${measured.input_lra}`,
    `measured_TP=${measured.input_tp}`,
    `measured_thresh=${measured.input_thresh}`,
    `offset=${measured.target_offset}`,
    'linear=true',
  ].join(':');
}

/** @param {string} text */
function parseLoudnormJson(text) {
  const match = String(text).match(/\{[\s\S]*"input_i"[\s\S]*\}/);
  if (!match) throw new Error('볼륨 맞추기(loudnorm) 측정 결과를 읽지 못했습니다.');
  /** @type {any} */
  let json;
  try {
    json = JSON.parse(match[0]);
  } catch {
    throw new Error('볼륨 맞추기(loudnorm) 측정 결과를 해석하지 못했습니다.');
  }
  const required = ['input_i', 'input_tp', 'input_lra', 'input_thresh', 'target_offset'];
  for (const key of required) {
    if (json[key] == null || String(json[key]).trim() === '') {
      throw new Error(`볼륨 맞추기 측정값이 불완전합니다 (${key}).`);
    }
  }
  return {
    input_i: String(json.input_i),
    input_tp: String(json.input_tp),
    input_lra: String(json.input_lra),
    input_thresh: String(json.input_thresh),
    target_offset: String(json.target_offset),
  };
}

/**
 * @param {string[]} parts
 */
function joinFilters(parts) {
  const clean = parts.filter(Boolean);
  return clean.length > 0 ? clean.join(',') : null;
}

/** @type {import('./registry.js').ConverterDefinition} */
export const adjustPitchVolume = {
  id: 'adjust-pitch-volume',
  label: '피치·볼륨 조절',
  description: '영상·음원의 피치와 볼륨을 조절합니다. 영상은 비디오를 복사하고 오디오만 변환합니다.',
  inputExts: INPUT_EXTS,
  outputExt: '.mp4',
  optionProfile: 'pitch-volume',
  defaultOptions: normalizeOptions({
    pitchStage: PITCH_ORIGINAL,
    volume: VOLUME_ORIGINAL,
    outputFormat: 'same',
    normalizeLoudness: false,
  }),
  normalizeOptions,
  resolveOutputExt,
  async run({ ffmpegPath, inputPath, outputPath, options, signal, onProgress }) {
    const opts = normalizeOptions(options);
    const ffprobePath = resolveFfprobeBinary().path;
    const sampleRate = await getAudioSampleRate(ffprobePath, inputPath);
    const hasVideo = await hasVideoStream(ffprobePath, inputPath);
    const useRubberband = opts.semitones !== 0 ? await hasRubberbandFilter(ffmpegPath) : false;
    const pitchParts = buildPitchParts(sampleRate, opts.semitones, useRubberband);
    const volumePart = buildVolumePart(opts.volume);
    const wantNormalize = opts.normalizeLoudness && opts.volume > 0;

    const inputExt = path.extname(inputPath).toLowerCase();
    const outputExt = path.extname(outputPath).toLowerCase();
    const keepVideo = hasVideo && outputExt !== '.mp3';

    const media = await probeMediaFile(inputPath);
    const estimated = media.ok && media.durationSec > 0 ? media.durationSec : null;

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    onProgress?.(0.02);

    /** @type {string | null} */
    let measuredLoudnorm = null;
    if (wantNormalize) {
      const measureFilter = joinFilters([...pitchParts, loudnormMeasureFilter()]);
      const measureArgs = ['-y', '-i', inputPath];
      if (measureFilter) measureArgs.push('-af', measureFilter);
      measureArgs.push('-f', 'null', process.platform === 'win32' ? 'NUL' : '/dev/null');

      const measure = await runFfmpeg(ffmpegPath, measureArgs, {
        signal,
        onStderr: (chunk) => {
          if (!onProgress || estimated == null) return;
          const t = parseFfmpegTimeSeconds(chunk);
          if (t == null) return;
          onProgress(Math.min(0.34, Math.max(0.02, (t / estimated) * 0.32)));
        },
      });
      if (measure.code !== 0) {
        throw new Error(
          measure.stderr.trim().split(/\r?\n/).slice(-8).join('\n') ||
            '볼륨 맞추기 측정에 실패했습니다.',
        );
      }
      measuredLoudnorm = loudnormApplyFilter(parseLoudnormJson(measure.stderr));
      onProgress?.(0.36);
    }

    /** @type {string[]} */
    const encodeParts = [...pitchParts];
    if (measuredLoudnorm) encodeParts.push(measuredLoudnorm);
    if (volumePart) encodeParts.push(volumePart);
    const audioFilter = joinFilters(encodeParts);

    /** @type {string[]} */
    const args = ['-y', '-i', inputPath];
    if (audioFilter) {
      args.push('-af', audioFilter);
      if (keepVideo) args.push('-c:v', 'copy');
      else args.push('-vn');
      args.push(...outputCodecArgs(outputPath));
    } else if (keepVideo && inputExt === outputExt) {
      args.push('-c', 'copy');
    } else if (hasVideo && outputExt === '.mp3') {
      args.push('-vn', ...outputCodecArgs(outputPath));
    } else if (inputExt === outputExt) {
      args.push('-c:a', 'copy');
    } else {
      if (keepVideo) args.push('-c:v', 'copy');
      else if (hasVideo) args.push('-vn');
      args.push(...outputCodecArgs(outputPath));
    }
    args.push(outputPath);

    const encodeOffset = wantNormalize ? 0.36 : 0.02;
    const encodeWeight = wantNormalize ? 0.62 : 0.97;

    const result = await runFfmpeg(ffmpegPath, args, {
      signal,
      onStderr: (chunk) => {
        if (!onProgress || estimated == null) return;
        const t = parseFfmpegTimeSeconds(chunk);
        if (t == null) return;
        onProgress(Math.min(0.99, encodeOffset + (t / estimated) * encodeWeight));
      },
    });

    if (result.code !== 0) {
      throw new Error(
        result.stderr.trim().split(/\r?\n/).slice(-8).join('\n') || '피치·볼륨 변환에 실패했습니다.',
      );
    }
    if (!fs.existsSync(outputPath)) throw new Error('출력 파일이 생성되지 않았습니다.');
    onProgress?.(1);
  },
};
