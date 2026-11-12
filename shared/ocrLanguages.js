/**
 * OCR 변환(PDF & 이미지) 언어 목록.
 * Tiny PDF Editor 와 같이 PP-OCRv5 ONNX 인식 모델을 쓰며, 기본은 한국어 모델(영문 포함)입니다.
 */

/**
 * @typedef {{
 *   id: string,
 *   label: string,
 *   defaultOn: boolean,
 *   modelId: string,
 *   hint?: string,
 * }} OcrLanguageOption
 */

/** @type {OcrLanguageOption[]} */
export const OCR_LANGUAGE_OPTIONS = [
  {
    id: 'korean',
    label: '한국어',
    defaultOn: true,
    modelId: 'korean',
    hint: '영문·숫자도 함께 인식합니다. (Tiny PDF Editor 와 동일 모델)',
  },
  {
    id: 'english',
    label: '영어',
    defaultOn: true,
    modelId: 'english',
    hint: '한국어를 켠 상태면 한국어 모델이 영문도 처리하므로 추가 다운로드가 없습니다.',
  },
  {
    id: 'chinese',
    label: '중국어',
    defaultOn: false,
    modelId: 'chinese',
    hint: '간체·번체·일본어 일부 포함 모델',
  },
  {
    id: 'japanese',
    label: '일본어',
    defaultOn: false,
    modelId: 'chinese',
    hint: '중국어 모델에 포함됩니다.',
  },
  {
    id: 'latin',
    label: '라틴 문자 (서유럽)',
    defaultOn: false,
    modelId: 'latin',
  },
  {
    id: 'cyrillic',
    label: '키릴 문자',
    defaultOn: false,
    modelId: 'cyrillic',
  },
];

/** 기본으로 켜 둘 언어 id */
export const DEFAULT_OCR_LANGUAGE_IDS = OCR_LANGUAGE_OPTIONS.filter((l) => l.defaultOn).map((l) => l.id);

/**
 * UI 에서 고른 언어 id → 받을 인식 모델 id 목록.
 * 한국어+영어면 한국어 모델만 쓰면 됩니다(영문 포함).
 *
 * @param {string[]} languageIds
 * @returns {string[]}
 */
export function resolveOcrModelIds(languageIds) {
  const selected = new Set((languageIds ?? []).map(String));
  /** @type {Set<string>} */
  const models = new Set();
  for (const opt of OCR_LANGUAGE_OPTIONS) {
    if (!selected.has(opt.id)) continue;
    if (opt.id === 'english' && selected.has('korean')) continue;
    models.add(opt.modelId);
  }
  if (models.size === 0) models.add('korean');
  return [...models];
}
