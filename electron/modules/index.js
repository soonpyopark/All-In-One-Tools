/**
 * ─── 기능 모듈 등록 지점 (backend) ───────────────────────────────────────────
 *
 * 새 기능을 추가할 때 이 폴더에 `electron/modules/<name>.js` 를 만들고
 * `register()` 에서 `defineApi()` 로 API 를 등록한 뒤, 아래 배열에 추가하세요.
 * 프론트엔드 쪽 등록 지점은 `src/features/registry.js` 입니다.
 */
import * as capture from './capture.js';
import * as cleanup from './cleanup.js';
import * as clock from './clock.js';
import * as convert from './convert.js';
import * as files from './files.js';
import * as launcher from './launcher.js';
import * as ocr from './ocr.js';
import * as pdfTools from './pdfTools.js';
import * as qr from './qr.js';
import * as rename from './rename.js';
import * as windowsSystem from './windowsSystem.js';

/** @type {{ register: () => void }[]} */
const MODULES = [
  convert,
  cleanup,
  capture,
  rename,
  ocr,
  qr,
  files,
  launcher,
  clock,
  pdfTools,
  windowsSystem,
];

export function registerModules() {
  for (const mod of MODULES) mod.register();
}
