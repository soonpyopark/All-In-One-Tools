import {
  APP_BUILD_STAMP,
  APP_FILE_NAME,
  APP_NAME,
  APP_VERSION,
  UPDATE_REPO,
  formatAppBuildStamp,
} from '../../shared/constants.js';
import { normalizeAccentColor } from '../../shared/theme.js';
import { runtime } from '../runtime.js';
import {
  getPublicSettings,
  getRememberedFolder,
  getSettings,
  rememberFolder,
  updateSettings,
} from '../settingsService.js';
import { fetchLatestRelease } from '../updateService.js';
import { defineApi } from './registry.js';

/** `settings.json` + OS-level values the settings UI shows together. */
function settingsPayload() {
  return {
    ...getSettings(),
    autoLaunch: runtime.autoLaunch?.get() ?? false,
    autoLaunchSupported: runtime.autoLaunch?.supported ?? false,
  };
}

export function registerCoreApi() {
  defineApi('app.info', () => ({
    name: APP_NAME,
    fileName: APP_FILE_NAME,
    version: APP_VERSION,
    buildStamp: APP_BUILD_STAMP,
    buildStampLabel: formatAppBuildStamp(APP_BUILD_STAMP),
    updateConfigured: Boolean(UPDATE_REPO),
    ...getPublicSettings(),
  }));

  /** Where the app keeps its data + how it was launched (환경설정 → 일반). */
  defineApi('app.runtime', () => ({
    isDev: runtime.isDev,
    portable: runtime.portable,
    stateRoot: runtime.stateRoot,
  }));

  defineApi('update.check', () => fetchLatestRelease());

  defineApi('settings.get', () => settingsPayload());

  /** Folder remembered for `key` (last input / output folder of a screen), '' if none. */
  defineApi('folders.get', (body) => ({ path: getRememberedFolder(String(body?.key ?? '')) }));

  defineApi('folders.set', async (body) => {
    await rememberFolder(String(body?.key ?? ''), typeof body?.path === 'string' ? body.path : '');
    return { path: getRememberedFolder(String(body?.key ?? '')) };
  });

  defineApi('settings.update', async (body) => {
    /** @type {Record<string, unknown>} */
    const patch = {};
    if ('accentColor' in body) patch.accentColor = normalizeAccentColor(body.accentColor);
    if ('startupUpdateCheck' in body) patch.startupUpdateCheck = Boolean(body.startupUpdateCheck);
    if ('ffmpegDir' in body) patch.ffmpegDir = typeof body.ffmpegDir === 'string' ? body.ffmpegDir.trim() : '';
    if ('exportDir' in body) patch.exportDir = typeof body.exportDir === 'string' ? body.exportDir.trim() : '';
    if ('autoLaunch' in body && runtime.autoLaunch?.supported) {
      runtime.autoLaunch.set(Boolean(body.autoLaunch));
    }
    await updateSettings(patch);
    return settingsPayload();
  });
}
