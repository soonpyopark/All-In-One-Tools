/**
 * App-wide constants shared by the Electron main process, the build scripts
 * and the renderer. Rebrand a new app from this file first.
 */

/** Display name (UI, window title). */
export const APP_NAME = 'All In One Tools';

/**
 * Windows AppUserModelID (`package.json` build.appId 와 동일).
 * main.js 에서 app.setAppUserModelId 로 건다.
 * (MSI ShortcutProperty 는 설치 중 Warning 1946 팝업을 자주 일으켜 사용하지 않음)
 */
export const APP_USER_MODEL_ID = 'com.alltools.app';

/** File-system friendly name used in installer / archive file names. */
export const APP_FILE_NAME = 'AllTools';

export const APP_VERSION = '1.0.1';

/**
 * Package build id (YYMMDD_HHMMSS). Rewritten by `npm run build:release*`
 * (scripts/sync-build-stamp.mjs); matches the suffix of the produced files.
 */
export const APP_BUILD_STAMP = '261112_214606';

/**
 * GitHub repository (`owner/repo`) whose latest release is used by the
 * 업데이트 확인 button. Leave empty until the project has a release page.
 */
export const UPDATE_REPO = 'soonpyopark/All-In-One-Tools';

/**
 * 페이지 순서·합치기·서명 등 PDF 편집은 Tiny PDF Editor 로 안내합니다.
 * @see https://github.com/soonpyopark/Tiny-PDF-Editor
 */
export const TINY_PDF_EDITOR_URL = 'https://github.com/soonpyopark/Tiny-PDF-Editor';
export const TINY_PDF_EDITOR_RELEASES_URL = `${TINY_PDF_EDITOR_URL}/releases`;

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
