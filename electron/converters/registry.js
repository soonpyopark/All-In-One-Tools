import { DEFAULT_SIZE_PRESET_ID, SIZE_PRESETS } from '../../shared/sizePresets.js';
import { PITCH_STAGES, VOLUME_MAX, VOLUME_MIN, VOLUME_ORIGINAL, VOLUME_STEP } from '../../shared/pitchVolume.js';
import { adjustPitchVolume } from './adjustPitchVolume.js';
import { mergeGifs } from './mergeGifs.js';
import { videoToGif } from './videoToGif.js';

/**
 * @typedef {Record<string, unknown>} ConvertOptions
 *
 * @typedef {{
 *   ffmpegPath: string,
 *   inputPath: string,
 *   inputPaths?: string[],
 *   outputPath: string,
 *   options: ConvertOptions,
 *   signal?: AbortSignal,
 *   onProgress?: (ratio: number) => void,
 * }} ConverterRunContext
 *
 * @typedef {{
 *   id: string,
 *   label: string,
 *   description?: string,
 *   inputExts: string[],
 *   outputExt: string,
 *   optionProfile?: 'gif' | 'pitch-volume' | 'merge-gifs',
 *   jobMode?: 'per-file' | 'merge',
 *   minInputs?: number,
 *   defaultOptions: ConvertOptions,
 *   defaultPresetId?: string,
 *   sizePresets?: import('../../shared/sizePresets.js').SizePreset[],
 *   normalizeOptions: (raw?: Record<string, unknown>) => ConvertOptions,
 *   resolveOutputExt?: (inputPath: string, options: ConvertOptions) => string,
 *   run: (ctx: ConverterRunContext) => Promise<void>,
 * }} ConverterDefinition
 */

/** @type {ConverterDefinition[]} */
const CONVERTERS = [
  { ...videoToGif, optionProfile: videoToGif.optionProfile ?? 'gif', jobMode: 'per-file' },
  mergeGifs,
  adjustPitchVolume,
];

/** @returns {Array<Omit<ConverterDefinition, 'normalizeOptions' | 'run' | 'resolveOutputExt'>>} */
export function listConverters() {
  return CONVERTERS.map((c) => ({
    id: c.id,
    label: c.label,
    description: c.description,
    inputExts: [...c.inputExts],
    outputExt: c.outputExt,
    optionProfile: c.optionProfile ?? 'gif',
    jobMode: c.jobMode ?? 'per-file',
    minInputs: c.minInputs ?? 1,
    defaultOptions: { ...c.defaultOptions },
    defaultPresetId: c.defaultPresetId ?? DEFAULT_SIZE_PRESET_ID,
    sizePresets: (c.sizePresets ?? SIZE_PRESETS).map((p) => ({ ...p })),
    pitchStages: c.optionProfile === 'pitch-volume' ? PITCH_STAGES.map((s) => ({ ...s })) : undefined,
    volumeMin: c.optionProfile === 'pitch-volume' ? VOLUME_MIN : undefined,
    volumeMax: c.optionProfile === 'pitch-volume' ? VOLUME_MAX : undefined,
    volumeStep: c.optionProfile === 'pitch-volume' ? VOLUME_STEP : undefined,
    volumeOriginal: c.optionProfile === 'pitch-volume' ? VOLUME_ORIGINAL : undefined,
  }));
}

/** @param {string} id */
export function getConverter(id) {
  return CONVERTERS.find((c) => c.id === id) ?? null;
}
