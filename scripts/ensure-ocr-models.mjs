#!/usr/bin/env node
/**
 * Tiny PDF Editor 와 같은 PP-OCRv5 기본 모델(검출 + 한국어 인식)을 ocr/models 에 둡니다.
 * 선택 언어 모델은 앱에서 처음 켤 때 받습니다.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MODELS_DIR = path.join(ROOT, 'ocr', 'models');
const MODELS = [
  {
    name: 'PP-OCRv5 mobile det',
    filename: 'det.onnx',
    url: 'https://huggingface.co/PaddlePaddle/PP-OCRv5_mobile_det_onnx/resolve/main/inference.onnx',
    sha256: 'a431985659dc921974177a95adcfbb90fd9e51989a5e04d70d0b75f597b6e61d',
  },
  {
    name: 'PP-OCRv5 korean rec',
    filename: 'rec_korean.onnx',
    url: 'https://huggingface.co/PaddlePaddle/korean_PP-OCRv5_mobile_rec_onnx/resolve/main/inference.onnx',
    sha256: '92f0b7785e64fc9090106a241cf4c1eb97472824558272751b88a2a4476d3a08',
  },
  {
    name: 'PP-OCRv5 korean dict',
    filename: 'rec_korean.yml',
    url: 'https://huggingface.co/PaddlePaddle/korean_PP-OCRv5_mobile_rec_onnx/resolve/main/inference.yml',
    sha256: 'f757fa1c40e99edcf27e9cce879b93eb2a51fa46f5ef39095689b8c37dd75998',
  },
];

function sha256File(filePath) {
  const digest = createHash('sha256');
  digest.update(fs.readFileSync(filePath));
  return digest.digest('hex');
}

async function download(spec, dest) {
  const response = await fetch(spec.url, {
    headers: { 'User-Agent': 'AllInOneTools-OCR/1.0' },
  });
  if (!response.ok) throw new Error(`${spec.name} 다운로드 실패 (HTTP ${response.status})`);
  const tmp = `${dest}.part`;
  fs.writeFileSync(tmp, Buffer.from(await response.arrayBuffer()));
  const digest = sha256File(tmp);
  if (digest !== spec.sha256) {
    fs.unlinkSync(tmp);
    throw new Error(`${spec.name} 해시가 맞지 않습니다.`);
  }
  fs.renameSync(tmp, dest);
}

async function main() {
  fs.mkdirSync(MODELS_DIR, { recursive: true });
  for (const spec of MODELS) {
    const dest = path.join(MODELS_DIR, spec.filename);
    if (fs.existsSync(dest) && sha256File(dest) === spec.sha256) continue;
    console.log(`[ocr] ${spec.name} 받는 중…`);
    await download(spec, dest);
  }
  console.log('[ocr] 기본 OCR 모델 준비됨');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
