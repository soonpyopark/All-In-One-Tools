import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { getAppContext } from '../context.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** 공통 검출 모델 (언어와 무관). Tiny PDF Editor 와 동일. */
export const DET_MODEL = {
  id: 'det',
  filename: 'det.onnx',
  url: 'https://huggingface.co/PaddlePaddle/PP-OCRv5_mobile_det_onnx/resolve/main/inference.onnx',
  sha256: 'a431985659dc921974177a95adcfbb90fd9e51989a5e04d70d0b75f597b6e61d',
};

/**
 * 인식 모델. korean 은 Tiny PDF Editor 기본 번들과 동일 해시.
 * 나머지 선택 언어는 처음 쓸 때 내려받습니다.
 */
export const REC_MODELS = {
  korean: {
    id: 'korean',
    label: '한국어(+영문)',
    onnx: 'rec_korean.onnx',
    dict: 'rec_korean.yml',
    onnxUrl: 'https://huggingface.co/PaddlePaddle/korean_PP-OCRv5_mobile_rec_onnx/resolve/main/inference.onnx',
    dictUrl: 'https://huggingface.co/PaddlePaddle/korean_PP-OCRv5_mobile_rec_onnx/resolve/main/inference.yml',
    onnxSha256: '92f0b7785e64fc9090106a241cf4c1eb97472824558272751b88a2a4476d3a08',
    dictSha256: 'f757fa1c40e99edcf27e9cce879b93eb2a51fa46f5ef39095689b8c37dd75998',
  },
  english: {
    id: 'english',
    label: '영어',
    onnx: 'rec_english.onnx',
    dict: 'rec_english.yml',
    onnxUrl: 'https://huggingface.co/PaddlePaddle/en_PP-OCRv5_mobile_rec_onnx/resolve/main/inference.onnx',
    dictUrl: 'https://huggingface.co/PaddlePaddle/en_PP-OCRv5_mobile_rec_onnx/resolve/main/inference.yml',
  },
  chinese: {
    id: 'chinese',
    label: '중국어·일본어',
    onnx: 'rec_chinese.onnx',
    dict: 'rec_chinese.yml',
    onnxUrl: 'https://huggingface.co/PaddlePaddle/PP-OCRv5_mobile_rec_onnx/resolve/main/inference.onnx',
    dictUrl: 'https://huggingface.co/PaddlePaddle/PP-OCRv5_mobile_rec_onnx/resolve/main/inference.yml',
  },
  latin: {
    id: 'latin',
    label: '라틴 문자',
    onnx: 'rec_latin.onnx',
    dict: 'rec_latin.yml',
    onnxUrl: 'https://huggingface.co/PaddlePaddle/latin_PP-OCRv5_mobile_rec_onnx/resolve/main/inference.onnx',
    dictUrl: 'https://huggingface.co/PaddlePaddle/latin_PP-OCRv5_mobile_rec_onnx/resolve/main/inference.yml',
  },
  cyrillic: {
    id: 'cyrillic',
    label: '키릴 문자',
    onnx: 'rec_cyrillic.onnx',
    dict: 'rec_cyrillic.yml',
    onnxUrl: 'https://huggingface.co/PaddlePaddle/cyrillic_PP-OCRv5_mobile_rec_onnx/resolve/main/inference.onnx',
    dictUrl: 'https://huggingface.co/PaddlePaddle/cyrillic_PP-OCRv5_mobile_rec_onnx/resolve/main/inference.yml',
  },
};

/** 개발/배포본에서 OCR 모델 폴더를 찾습니다. */
export function modelsDir() {
  try {
    const { isDev, projectRoot } = getAppContext();
    if (isDev) return path.join(projectRoot, 'ocr', 'models');
  } catch {
    // 컨텍스트 전 (스크립트·테스트)
  }
  try {
    // electron 이 없으면 실패하므로 동적 import 대신 require 없이 process.resourcesPath 만 본다.
    if (process.resourcesPath && process.versions?.electron) {
      return path.join(process.resourcesPath, 'ocr', 'models');
    }
  } catch {
    // ignore
  }
  return path.resolve(__dirname, '../../ocr/models');
}

/** @param {string} filePath */
export function sha256File(filePath) {
  const digest = createHash('sha256');
  digest.update(fs.readFileSync(filePath));
  return digest.digest('hex');
}

/**
 * @param {string} filePath
 * @param {string | undefined} expected
 */
function fileOk(filePath, expected) {
  if (!fs.existsSync(filePath)) return false;
  if (!expected) return fs.statSync(filePath).size > 1000;
  try {
    return sha256File(filePath) === expected;
  } catch {
    return false;
  }
}

/** @param {string} modelId */
export function recModelReady(modelId, folder = modelsDir()) {
  const spec = REC_MODELS[modelId];
  if (!spec) return false;
  return fileOk(path.join(folder, spec.onnx), spec.onnxSha256) && fileOk(path.join(folder, spec.dict), spec.dictSha256);
}

/** 검출 모델 + 기본 한국어 인식 모델이 있는지. */
export function coreModelsReady(folder = modelsDir()) {
  return fileOk(path.join(folder, DET_MODEL.filename), DET_MODEL.sha256) && recModelReady('korean', folder);
}

/**
 * @param {string[]} modelIds
 */
export function missingModels(modelIds, folder = modelsDir()) {
  /** @type {{ id: string, label: string, files: string[] }[]} */
  const missing = [];
  if (!fileOk(path.join(folder, DET_MODEL.filename), DET_MODEL.sha256)) {
    missing.push({ id: 'det', label: '글자 검출', files: [DET_MODEL.filename] });
  }
  for (const id of modelIds) {
    const spec = REC_MODELS[id];
    if (!spec) continue;
    if (!recModelReady(id, folder)) {
      missing.push({ id, label: spec.label, files: [spec.onnx, spec.dict] });
    }
  }
  return missing;
}

/**
 * 필요한 모델을 Hugging Face 에서 받습니다.
 *
 * @param {string[]} modelIds
 * @param {(message: string) => void} [onLog]
 */
export async function ensureModels(modelIds, onLog) {
  const folder = modelsDir();
  fs.mkdirSync(folder, { recursive: true });

  /** @param {{ filename: string, url: string, sha256?: string, name: string }} spec */
  const download = async (spec) => {
    const dest = path.join(folder, spec.filename);
    if (fileOk(dest, spec.sha256)) return;
    onLog?.(`${spec.name} 받는 중…`);
    const response = await fetch(spec.url, {
      headers: { 'User-Agent': 'AllInOneTools-OCR/1.0' },
    });
    if (!response.ok) throw new Error(`${spec.name} 다운로드 실패 (HTTP ${response.status})`);
    const tmp = `${dest}.part`;
    fs.writeFileSync(tmp, Buffer.from(await response.arrayBuffer()));
    if (spec.sha256) {
      const digest = sha256File(tmp);
      if (digest !== spec.sha256) {
        fs.unlinkSync(tmp);
        throw new Error(`${spec.name} 해시가 맞지 않습니다.`);
      }
    }
    fs.renameSync(tmp, dest);
    onLog?.(`${spec.name} 준비됨`);
  };

  await download({
    filename: DET_MODEL.filename,
    url: DET_MODEL.url,
    sha256: DET_MODEL.sha256,
    name: '글자 검출 모델',
  });

  for (const id of modelIds) {
    const spec = REC_MODELS[id];
    if (!spec) continue;
    await download({
      filename: spec.onnx,
      url: spec.onnxUrl,
      sha256: spec.onnxSha256,
      name: `${spec.label} 인식 모델`,
    });
    await download({
      filename: spec.dict,
      url: spec.dictUrl,
      sha256: spec.dictSha256,
      name: `${spec.label} 문자표`,
    });
  }

  return folder;
}
