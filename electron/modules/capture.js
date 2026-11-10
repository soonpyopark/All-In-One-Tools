import path from 'node:path';
import { app, globalShortcut } from 'electron';
import { ApiError, defineApi } from '../api/registry.js';
import { hideAppWindows, restoreAppWindows } from '../capture/appWindows.js';
import { getRunStatus, getCursorPosition, isRunning, startMacro, stopMacro } from '../capture/macroRunner.js';
import { statePath } from '../context.js';
import { readJsonSync, writeJsonSync } from '../jsonStore.js';
import { identifyDisplays } from '../capture/identifyDisplays.js';
import { getPreset, listPresets, movePreset, normalizeTarget, removePreset, savePreset } from '../capture/presets.js';
import { pickRegion } from '../capture/regionPicker.js';
import { captureTarget, listTargets, saveImage } from '../capture/screenCapture.js';

/** 매크로 화면 캡처: 화면/창/영역 캡처와 키보드·마우스 매크로 프리셋. */

const defaultOutputDir = () => path.join(app.getPath('pictures'), 'All In One Tools');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** @param {unknown} err */
const toApiError = (err) => (err instanceof ApiError ? err : new ApiError(err instanceof Error ? err.message : String(err)));

/* -------------------------------------------------------------------------- */
/* 전역 단축키 (시작 / 중지)                                                    */
/* -------------------------------------------------------------------------- */

/** @type {{ presetId: string, startKey: string, stopKey: string } | null} */
let armed = null;
/** 단축키로 시작하다 난 오류 (화면에 보여 줍니다) */
let hotkeyError = '';
/** 단축키 사용 여부. 기본은 켜짐이며, 사용자가 끄면 다음 실행에도 꺼진 채로 둡니다. */
let hotkeysEnabled = true;

const HOTKEY_FILE = 'macroHotkey.json';

/** @returns {{ enabled: boolean, presetId: string }} */
function loadHotkeySetting() {
  const raw = readJsonSync(statePath(HOTKEY_FILE), {});
  return { enabled: raw?.enabled !== false, presetId: typeof raw?.presetId === 'string' ? raw.presetId : '' };
}

/** @param {{ enabled: boolean, presetId: string }} setting */
function saveHotkeySetting(setting) {
  try {
    writeJsonSync(statePath(HOTKEY_FILE), setting);
  } catch {
    // 저장하지 못해도 이번 실행에는 영향이 없습니다.
  }
}

function disarm() {
  if (!armed) return;
  for (const key of new Set([armed.startKey, armed.stopKey])) {
    try {
      globalShortcut.unregister(key);
    } catch {
      // 이미 해제된 경우
    }
  }
  armed = null;
}

/** @param {string} presetId */
async function startFromHotkey(presetId) {
  try {
    const preset = getPreset(presetId);
    if (!preset) throw new Error('프리셋을 찾을 수 없습니다.');
    hotkeyError = '';
    await startMacro(preset, { defaultOutputDir: defaultOutputDir() });
  } catch (err) {
    hotkeyError = err instanceof Error ? err.message : String(err);
  }
}

/** @param {import('../capture/presets.js').MacroPreset} preset */
function arm(preset) {
  disarm();
  hotkeyError = '';
  const { startKey, stopKey } = preset;
  const onStart = () => {
    if (isRunning()) {
      // 시작/중지에 같은 키를 쓰면 토글로 동작합니다.
      if (startKey === stopKey) stopMacro();
      return;
    }
    void startFromHotkey(preset.id);
  };
  if (!globalShortcut.register(startKey, onStart)) {
    throw new ApiError(`시작 단축키(${startKey})를 등록하지 못했습니다. 다른 프로그램이 이미 사용 중일 수 있습니다.`);
  }
  if (stopKey !== startKey && !globalShortcut.register(stopKey, () => void stopMacro())) {
    globalShortcut.unregister(startKey);
    throw new ApiError(`중지 단축키(${stopKey})를 등록하지 못했습니다. 다른 프로그램이 이미 사용 중일 수 있습니다.`);
  }
  armed = { presetId: preset.id, startKey, stopKey };
}

/* -------------------------------------------------------------------------- */
/* API                                                                        */
/* -------------------------------------------------------------------------- */

export function register() {
  app.on('will-quit', () => {
    stopMacro();
    globalShortcut.unregisterAll();
  });

  defineApi('capture.info', () => ({ defaultOutputDir: defaultOutputDir() }));

  /** 선택할 수 있는 화면 / 창 목록 */
  defineApi('capture.targets', async () => {
    try {
      return await listTargets();
    } catch (err) {
      throw toApiError(err);
    }
  });

  /** 모든 모니터에 번호를 잠깐 띄워 어느 모니터가 몇 번인지 보여 줍니다. */
  defineApi('capture.identifyDisplays', () => {
    try {
      return identifyDisplays();
    } catch (err) {
      throw toApiError(err);
    }
  });

  /** 지금 마우스 위치 (매크로 좌표계) */
  defineApi('capture.cursorPos', async () => {
    try {
      return await getCursorPosition();
    } catch (err) {
      throw toApiError(err);
    }
  });

  /** 모든 모니터 위에서 드래그로 캡처 영역을 고릅니다(절대 좌표). 취소하면 `region: null`. */
  defineApi('capture.pickRegion', async () => {
    if (isRunning()) throw new ApiError('매크로 실행 중에는 영역을 선택할 수 없습니다.');
    const hidden = await hideAppWindows();
    try {
      return { region: await pickRegion() };
    } catch (err) {
      throw toApiError(err);
    } finally {
      restoreAppWindows(hidden);
    }
  });

  /** 지금 한 장 캡처해서 저장합니다. */
  defineApi('capture.snap', async (body) => {
    if (isRunning()) throw new ApiError('매크로 실행 중에는 캡처할 수 없습니다.');
    const target = normalizeTarget(body?.target);
    const format = body?.format === 'jpg' ? 'jpg' : 'png';
    const quality = Math.min(100, Math.max(10, Math.round(Number(body?.jpegQuality) || 90)));
    const delayMs = Math.min(30_000, Math.max(0, Math.round(Number(body?.delayMs) || 0)));
    const dir = path.resolve(String(body?.outputDir ?? '').trim() || defaultOutputDir());

    const hidden = body?.hideApp === false ? [] : await hideAppWindows();
    try {
      if (delayMs > 0) await sleep(delayMs);
      const image = await captureTarget(target);
      const filePath = path.join(dir, `snap_${stamp()}.${format}`);
      saveImage(image, filePath, format, quality);
      const size = image.getSize();
      return { path: filePath, width: size.width, height: size.height };
    } catch (err) {
      throw toApiError(err);
    } finally {
      restoreAppWindows(hidden);
    }
  });

  /* ---- 프리셋 ---- */

  defineApi('capture.presets.list', () => ({ presets: listPresets() }));

  defineApi('capture.presets.save', async (body) => {
    try {
      const preset = await savePreset(body?.preset);
      // 단축키가 활성화된 프리셋이면 바뀐 단축키로 다시 등록합니다.
      let rearmError = '';
      if (armed?.presetId === preset.id) {
        try {
          arm(preset);
        } catch (err) {
          disarm();
          rearmError = err instanceof Error ? err.message : String(err);
        }
      }
      return { preset, presets: listPresets(), rearmError };
    } catch (err) {
      throw toApiError(err);
    }
  });

  defineApi('capture.presets.remove', async (body) => {
    const id = String(body?.id ?? '');
    if (armed?.presetId === id) disarm();
    return { presets: await removePreset(id) };
  });

  defineApi('capture.presets.move', async (body) => ({
    presets: await movePreset(String(body?.id ?? ''), Number(body?.direction) < 0 ? -1 : 1),
  }));

  /* ---- 실행 / 중지 ---- */

  defineApi('capture.macro.start', async (body) => {
    const preset = body?.preset ? await savePreset(body.preset) : getPreset(String(body?.presetId ?? ''));
    if (!preset) throw new ApiError('프리셋을 찾을 수 없습니다.', 404);
    try {
      hotkeyError = '';
      return { run: await startMacro(preset, { defaultOutputDir: defaultOutputDir() }) };
    } catch (err) {
      throw toApiError(err);
    }
  });

  defineApi('capture.macro.stop', () => ({ stopped: stopMacro() }));

  defineApi('capture.macro.status', () => ({
    run: getRunStatus(),
    armed: armed ? { ...armed } : null,
    enabled: hotkeysEnabled,
    hotkeyError,
  }));

  /** 프리셋의 시작/중지 단축키를 켭니다. (앱이 다른 창 뒤에 있어도 동작) */
  defineApi('capture.hotkeys.arm', (body) => {
    const preset = getPreset(String(body?.presetId ?? ''));
    if (!preset) throw new ApiError('프리셋을 찾을 수 없습니다. 먼저 저장해 주세요.', 404);
    arm(preset);
    hotkeysEnabled = true;
    saveHotkeySetting({ enabled: true, presetId: preset.id });
    return { armed: { ...armed } };
  });

  defineApi('capture.hotkeys.disarm', () => {
    const presetId = armed?.presetId ?? '';
    disarm();
    hotkeysEnabled = false;
    saveHotkeySetting({ enabled: false, presetId });
    return { armed: null };
  });

  // 단축키는 기본 켜짐: 앱이 시작되면 마지막으로 쓴(없으면 첫 번째) 프리셋의 단축키를 바로 등록합니다.
  try {
    const setting = loadHotkeySetting();
    hotkeysEnabled = setting.enabled;
    if (hotkeysEnabled) {
      const preset = getPreset(setting.presetId) ?? listPresets()[0];
      if (preset) arm(preset);
    }
  } catch (err) {
    hotkeyError = err instanceof Error ? err.message : String(err);
  }
}
