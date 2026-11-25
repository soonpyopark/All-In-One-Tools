/**
 * 앱 전역 상수 (Electron 메인·빌드 스크립트·렌더러 공용).
 */

/** Display name (UI, window title). */
export const APP_NAME = 'All In One Tools';

/** 메인 창 최초 실행 크기 (초기화 시에도 이 크기로 되돌림). */
export const MAIN_WINDOW_WIDTH = 1280;
export const MAIN_WINDOW_HEIGHT = 800;
export const MAIN_WINDOW_MIN_WIDTH = 960;
export const MAIN_WINDOW_MIN_HEIGHT = 600;

/**
 * Windows AppUserModelID (`package.json` build.appId 와 동일).
 * main.js 에서 app.setAppUserModelId 로 건다.
 * (MSI ShortcutProperty 는 설치 중 Warning 1946 팝업을 자주 일으켜 사용하지 않음)
 */
export const APP_USER_MODEL_ID = 'com.alltools.app';

/** File-system friendly name used in installer / archive file names. */
export const APP_FILE_NAME = 'AllTools';

/**
 * 앱 표시·MSI ProductVersion (점 구분). 예: `1.0.1.5`
 *
 * 배포 시 버전 표기 규칙 (이후 릴리스도 동일):
 * - UI / `APP_VERSION` / MSI: `1.0.1.N`  (점)
 * - Git 태그·GitHub Release: `v1.0.1-N`  (하이픈) ← `APP_GIT_TAG`
 * - `package.json` version: `1.0.1-N`  (electron-builder semver)
 */
export const APP_VERSION = '1.0.2.3';

/**
 * Git 태그 문자열. `1.0.1.5` → `v1.0.1-5`
 * @param {string} [version]
 */
export function formatAppGitTag(version = APP_VERSION) {
  const body = String(version ?? '')
    .trim()
    .replace(/^v/i, '');
  const matched = /^(\d+\.\d+\.\d+)\.(\d+)$/.exec(body);
  if (matched) return `v${matched[1]}-${matched[2]}`;
  return `v${body}`;
}

/** 현재 릴리스용 Git 태그 (예: v1.0.1-5) */
export const APP_GIT_TAG = formatAppGitTag(APP_VERSION);

/**
 * Package build id (YYMMDD_HHMMSS). Rewritten by `npm run build:release*`
 * (scripts/sync-build-stamp.mjs); matches the suffix of the produced files.
 */
export const APP_BUILD_STAMP = '261125_132924';

/**
 * GitHub repository (`owner/repo`) whose latest release is used by the
 * 업데이트 확인 button. Leave empty until the project has a release page.
 */
export const UPDATE_REPO = 'soonpyopark/All-In-One-Tools';

/**
 * 페이지 순서·합치기·서명 등 PDF 편집은 Tiny PDF Editor 릴리스로 안내합니다.
 * @see https://github.com/soonpyopark/Tiny-PDF-Editor/releases
 */
export const TINY_PDF_EDITOR_URL = 'https://github.com/soonpyopark/Tiny-PDF-Editor/releases';

/** 출장 경로 찾기 (Path Finder) — 런처 기본 바로가기용. */
export const PATH_FINDER_URL = 'https://pathfinder-eight-pearl.vercel.app/';

/** Content hash of build/icon-source.png (scripts/prepare-icons.mjs). */
export { APP_ICON_REV } from './iconRev.js';

/** Web UI icon (served from public/). Query busts Chrome's sticky favicon cache. */
export const APP_ICON_URL = '/icon.png';

/**
 * @param {string} [stamp]
 * @returns {string} `YYYY-MM-DD HH:MM:SS`
 */
export function formatAppBuildStamp(stamp = APP_BUILD_STAMP) {
  if (/^0+_0+$/.test(String(stamp ?? '').trim())) return '개발 빌드';
  const match = /^(\d{2})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})$/.exec(String(stamp ?? '').trim());
  if (!match) return String(stamp ?? '').trim();
  return `${2000 + Number(match[1])}-${match[2]}-${match[3]} ${match[4]}:${match[5]}:${match[6]}`;
}
