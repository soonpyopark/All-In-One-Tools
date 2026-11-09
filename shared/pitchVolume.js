/**
 * Pitch / volume stages shared by the Adjust Pitch converter and Convert UI.
 * Slider values match Adjust Pitch & Volume v1.0.0.
 */

/** @type {ReadonlyArray<{ stage: number, label: string, semitones: number }>} */
export const PITCH_STAGES = Object.freeze([
  { stage: 0, label: '-1.5 한음반', semitones: -1.5 },
  { stage: 1, label: '-1.0 한음', semitones: -1.0 },
  { stage: 2, label: '-0.5 반음', semitones: -0.5 },
  { stage: 3, label: '0 (원본)', semitones: 0 },
  { stage: 4, label: '+0.5 반음', semitones: 0.5 },
  { stage: 5, label: '+1.0 한음', semitones: 1.0 },
  { stage: 6, label: '+1.5 한음반', semitones: 1.5 },
]);

export const PITCH_MIN = 0;
export const PITCH_MAX = 6;
export const PITCH_ORIGINAL = 3;

export const VOLUME_MIN = 0;
export const VOLUME_MAX = 100;
export const VOLUME_STEP = 5;
/** Slider mid-point = 100% (원본). Max = 200%. */
export const VOLUME_ORIGINAL = 50;

/**
 * Target integrated loudness (LUFS) for cross-file volume matching.
 * -16 is a common streaming / spoken-content target.
 */
export const LOUDNORM_I = -16;
export const LOUDNORM_TP = -1.5;
export const LOUDNORM_LRA = 11;

/** @param {number} stage */
export function pitchStageLabel(stage) {
  const found = PITCH_STAGES.find((item) => item.stage === stage);
  return found?.label ?? '0 (원본)';
}

/** @param {number} volume slider 0–100 */
export function volumePercentLabel(volume) {
  const n = Number(volume);
  if (!Number.isFinite(n)) return '100% (원본)';
  const pct = Math.round((n / VOLUME_ORIGINAL) * 100);
  if (pct === 100) return '100% (원본)';
  return `${pct}%`;
}
