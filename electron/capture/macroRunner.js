import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { hideAppWindows, restoreAppWindows } from './appWindows.js';
import { captureTarget, imageSignature, saveImage, signatureDiff } from './screenCapture.js';

/**
 * 매크로 실행기. 키보드/마우스 입력은 nut.js 로 보내고, 캡처 단계는 Electron 으로 처리합니다.
 * 동시에 하나의 매크로만 실행합니다.
 *
 * @typedef {import('./presets.js').MacroPreset} MacroPreset
 * @typedef {import('./presets.js').MacroStep} MacroStep
 * @typedef {{
 *   id: string,
 *   presetId: string,
 *   presetName: string,
 *   state: 'running' | 'done' | 'stopped' | 'error',
 *   iteration: number,
 *   repeat: number,
 *   stepIndex: number,
 *   stepCount: number,
 *   captures: number,
 *   folderCount: number,
 *   outputDir: string,
 *   error: string,
 *   note: string,
 *   logs: string[],
 *   startedAt: number,
 *   finishedAt: number | null,
 * }} MacroRun
 */

/** 화면 전환을 기다릴 때 다시 캡처해 보는 간격 (ms) */
const POLL_MS = 400;

/** 화면이 바뀐 뒤 "멈출 때까지" 기다리는 최대 시간 (ms). 계속 움직이는 화면이어도 이 시간 뒤에는 저장합니다. */
const STABLE_MAX_MS = 5000;

/** @type {MacroRun | null} */
let run = null;
/** @type {AbortController | null} */
let controller = null;
/** @type {Promise<any> | null} */
let nutPromise = null;

/** nut.js 는 네이티브 모듈이라 처음 쓸 때 불러옵니다. (불러오지 못해도 앱의 다른 기능은 그대로 동작) */
function loadNut() {
  if (!nutPromise) {
    nutPromise = import('@nut-tree-fork/nut-js')
      .then((nut) => {
        nut.keyboard.config.autoDelayMs = 0;
        nut.mouse.config.autoDelayMs = 0;
        return nut;
      })
      .catch((error) => {
        nutPromise = null;
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`키보드/마우스 제어 모듈(nut.js)을 불러오지 못했습니다.\n${detail}`);
      });
  }
  return nutPromise;
}

/** 현재 마우스 위치 (nut.js 좌표계 = 매크로 좌표계) */
export async function getCursorPosition() {
  const nut = await loadNut();
  const point = await nut.mouse.getPosition();
  return { x: point.x, y: point.y };
}

/**
 * 폴더 안의 이미지 파일(png/jpg/jpeg) 개수.
 * @param {string} dir
 */
function countImages(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile() && /\.(?:png|jpe?g)$/i.test(e.name)).length;
  } catch {
    return 0;
  }
}

/**
 * 폴더에 이미 있는 `0001.png` 같은 번호 파일 중 가장 큰 번호. (이어서 저장할 때 덮어쓰지 않기 위해)
 * @param {string} dir
 */
function lastNumberedFile(dir) {
  let max = 0;
  try {
    for (const name of fs.readdirSync(dir)) {
      const match = /^(\d+)\.(?:png|jpe?g)$/i.exec(name);
      if (match) max = Math.max(max, Number(match[1]));
    }
  } catch {
    // 폴더가 아직 없으면 처음부터
  }
  return max;
}

/**
 * 중간에 중지할 수 있는 대기.
 * @param {number} ms
 * @param {AbortSignal} signal
 */
async function sleep(ms, signal) {
  const end = Date.now() + ms;
  while (!signal.aborted) {
    const left = end - Date.now();
    if (left <= 0) return;
    await new Promise((resolve) => setTimeout(resolve, Math.min(left, 50)));
  }
}

/** @param {MacroRun} state @param {string} line */
function log(state, line) {
  state.logs.push(line);
  if (state.logs.length > 200) state.logs.splice(0, state.logs.length - 200);
}

export function getRunStatus() {
  return run ? structuredClone(run) : null;
}

export function isRunning() {
  return run?.state === 'running';
}

export function stopMacro() {
  if (!run || run.state !== 'running') return false;
  controller?.abort();
  return true;
}

/**
 * @param {any} nut
 * @param {Extract<MacroStep, { type: 'key' }>} step
 * @param {{ keys: Set<any>, buttons: Set<any> }} held 눌린 채 남은 키/버튼 (중지 때 정리)
 */
async function runKeyStep(nut, step, held) {
  const key = nut.Key[step.key];
  if (key === undefined) throw new Error(`지원하지 않는 키입니다: ${step.key}`);
  if (step.action === 'down') {
    held.keys.add(key);
    await nut.keyboard.pressKey(key);
  } else if (step.action === 'up') {
    held.keys.delete(key);
    await nut.keyboard.releaseKey(key);
  } else {
    await nut.keyboard.pressKey(key);
    await new Promise((resolve) => setTimeout(resolve, 30));
    await nut.keyboard.releaseKey(key);
  }
}

/**
 * @param {any} nut
 * @param {Extract<MacroStep, { type: 'mouse' }>} step
 * @param {{ keys: Set<any>, buttons: Set<any> }} held
 */
async function runMouseStep(nut, step, held) {
  await nut.mouse.setPosition(new nut.Point(step.x, step.y));
  const button = step.button === 'right' ? nut.Button.RIGHT : step.button === 'middle' ? nut.Button.MIDDLE : nut.Button.LEFT;
  if (step.action === 'click') await nut.mouse.click(button);
  else if (step.action === 'double') await nut.mouse.doubleClick(button);
  else if (step.action === 'down') {
    held.buttons.add(button);
    await nut.mouse.pressButton(button);
  } else if (step.action === 'up') {
    held.buttons.delete(button);
    await nut.mouse.releaseButton(button);
  } else if (step.action === 'scroll') {
    if (step.amount > 0) await nut.mouse.scrollDown(step.amount);
    else if (step.amount < 0) await nut.mouse.scrollUp(-step.amount);
  }
}

/** @param {MacroStep} step */
export function describeStep(step) {
  if (step.type === 'delay') return `시간지연 ${step.ms}ms`;
  if (step.type === 'key') return `키보드 ${step.key} ${step.action}`;
  if (step.type === 'mouse') return `마우스 (${step.x}, ${step.y}) ${step.action}`;
  return `캡처 (${step.target.mode})`;
}

/**
 * 매크로를 시작합니다. 이미 실행 중이면 오류입니다.
 * 실행은 백그라운드로 진행되고, 진행 상태는 `getRunStatus()` 로 확인합니다.
 *
 * @param {MacroPreset} preset
 * @param {{ defaultOutputDir: string, onFinish?: () => void }} options
 * @returns {Promise<MacroRun>}
 */
export async function startMacro(preset, options) {
  if (isRunning()) throw new Error('이미 매크로가 실행 중입니다.');
  if (preset.steps.length === 0) throw new Error('매크로에 단계가 없습니다. 먼저 단계를 추가해 주세요.');
  // 반복 횟수는 "저장한 이미지 수" 기준이라, 캡처 단계가 없으면 끝나지 않습니다.
  if (preset.repeat > 0 && !preset.steps.some((step) => step.type === 'capture')) {
    throw new Error('저장할 이미지 수를 지정하려면 캡처 단계가 하나 이상 필요합니다. 캡처 단계를 추가해 주세요.');
  }
  const nut = await loadNut();

  // 지정한 폴더에 바로 저장합니다. (하위 폴더를 만들지 않음. 이미 있는 번호 파일은 덮어쓰지 않고 이어서 번호를 매김)
  const outputDir = path.resolve(preset.outputDir || options.defaultOutputDir);
  const firstNumber = lastNumberedFile(outputDir) + 1;
  // 목표(repeat)는 "저장 폴더 안의 이미지 수" 기준입니다. (기존 파일 포함)
  const existingCount = countImages(outputDir);
  if (preset.repeat > 0 && existingCount >= preset.repeat) {
    throw new Error(
      `저장 폴더에 이미 이미지가 ${existingCount}개 있어 목표(${preset.repeat}장)에 도달했습니다.\n목표 이미지 수를 늘리거나 다른 폴더를 지정해 주세요.`,
    );
  }
  const abort = new AbortController();
  controller = abort;

  /** @type {MacroRun} */
  const state = {
    id: randomUUID(),
    presetId: preset.id,
    presetName: preset.name,
    state: 'running',
    iteration: 0,
    repeat: preset.repeat,
    stepIndex: -1,
    stepCount: preset.steps.length,
    captures: 0,
    folderCount: existingCount,
    outputDir,
    error: '',
    note: '',
    logs: [],
    startedAt: Date.now(),
    finishedAt: null,
  };
  run = state;

  const hasCapture = preset.steps.some((step) => step.type === 'capture');
  if (hasCapture) fs.mkdirSync(outputDir, { recursive: true });

  void (async () => {
    /** @type {import('electron').BrowserWindow[]} */
    let hidden = [];
    const held = { keys: new Set(), buttons: new Set() };
    try {
      if (preset.hideApp) hidden = await hideAppWindows();
      if (preset.startDelayMs > 0) {
        log(state, `${preset.startDelayMs}ms 뒤에 시작합니다.`);
        await sleep(preset.startDelayMs, abort.signal);
      }

      /** 캡처 단계별로 직전에 저장한 이미지의 지문 (단계 번호 → 지문) */
      /** @type {Map<number, Uint8Array>} */
      const previous = new Map();
      let finishedEarly = false;

      /**
       * 캡처 단계 `captureIndex` 의 "다음 페이지로 넘기는 동작": 직전 캡처 이후 실행된 키/마우스/지연 단계들.
       * 매크로는 같은 순서로 반복되므로 그 단계 뒤쪽 → 앞쪽 순서로 이어 붙이면 됩니다.
       * @param {number} captureIndex
       */
      const pageTurnSteps = (captureIndex) =>
        [...preset.steps.slice(captureIndex + 1), ...preset.steps.slice(0, captureIndex)].filter((s) => s.type !== 'capture');

      /** 캡처가 아닌 단계 하나를 실행합니다. @param {MacroStep} step */
      const runInputStep = async (step) => {
        if (step.type === 'delay') await sleep(step.ms, abort.signal);
        else if (step.type === 'key') await runKeyStep(nut, step, held);
        else if (step.type === 'mouse') await runMouseStep(nut, step, held);
      };

      // 끝나는 조건: 저장한 이미지가 목표 장수(repeat)에 도달 / 같은 화면이 계속됨(마지막 페이지) / 사용자 중지
      for (let iteration = 1; !abort.signal.aborted && !finishedEarly; iteration += 1) {
        state.iteration = iteration;
        for (let index = 0; index < preset.steps.length; index += 1) {
          if (abort.signal.aborted) break;
          state.stepIndex = index;
          const step = preset.steps[index];

          if (step.type !== 'capture') {
            await runInputStep(step);
            continue;
          }

          let image = await captureTarget(step.target);
          let signature = imageSignature(image);
          const before = previous.get(index);
          const isSame = () => before !== undefined && signatureDiff(before, signature) < preset.sameThreshold;
          const recapture = async () => {
            image = await captureTarget(step.target);
            signature = imageSignature(image);
          };

          if (preset.detectSame && before !== undefined) {
            // 1) 직전과 같으면 페이지가 아직 안 넘어간 것입니다. 입력을 다시 보내지 않고 화면이 바뀔 때까지 기다립니다.
            //    (느린 뷰어에서 입력을 다시 보내면 밀려 있던 입력이 한꺼번에 처리되어 페이지를 건너뛰기 때문)
            //    끝나는 조건은 "폴더의 이미지 수가 목표에 도달"이므로, 화면이 안 바뀌어도 여기서 마지막 페이지로 간주하지 않습니다.
            if (isSame()) {
              const waitStart = Date.now();
              let resent = false;
              log(state, '직전과 같은 화면입니다. 화면이 바뀔 때까지 기다립니다.');
              while (isSame() && !abort.signal.aborted) {
                // 선택 사항: 정해진 시간이 지나도 안 바뀌면 넘기는 동작을 한 번만 다시 보냅니다.
                if (preset.resendOnTimeout && !resent && Date.now() - waitStart >= preset.changeTimeoutMs) {
                  resent = true;
                  log(state, '화면이 바뀌지 않아 넘기는 동작을 한 번 다시 보냅니다.');
                  for (const turnStep of pageTurnSteps(index)) {
                    if (abort.signal.aborted) break;
                    await runInputStep(turnStep);
                  }
                }
                // 변화량을 같이 보여 주면 "화면은 바뀌었는데 같은 화면으로 판단"되는 경우를 알아보기 쉽습니다.
                const changed = signatureDiff(before, signature);
                state.note = `화면 전환 대기 중 (${((Date.now() - waitStart) / 1000).toFixed(1)}초 · 변화 ${changed.toFixed(3)}%)`;
                await sleep(POLL_MS, abort.signal);
                if (abort.signal.aborted) break;
                await recapture();
              }
              state.note = '';
              if (abort.signal.aborted) break;
            }

            // 2) 화면이 바뀌었으면, 전환 중인 화면이 저장되지 않도록 화면이 멈출 때까지 기다린 뒤 저장합니다.
            const stableDeadline = Date.now() + STABLE_MAX_MS;
            while (!abort.signal.aborted && Date.now() < stableDeadline) {
              const last = signature;
              await sleep(POLL_MS, abort.signal);
              if (abort.signal.aborted) break;
              await recapture();
              if (signatureDiff(last, signature) < preset.sameThreshold) break;
            }
            if (abort.signal.aborted) break;
          }

          state.captures += 1;
          const file = path.join(outputDir, `${String(firstNumber + state.captures - 1).padStart(4, '0')}.${preset.format}`);
          saveImage(image, file, preset.format, preset.jpegQuality);
          previous.set(index, signature);

          // 폴더 안의 이미지 수가 목표에 도달하면(= 마지막 페이지) 다음 페이지로 더 넘기지 않고 바로 끝냅니다.
          state.folderCount += 1;
          if (preset.repeat > 0 && state.folderCount >= preset.repeat) {
            log(state, `폴더의 이미지가 목표 ${preset.repeat}장에 도달했습니다.`);
            finishedEarly = true;
            break;
          }
        }
      }

      state.state = abort.signal.aborted ? 'stopped' : 'done';
      log(state, abort.signal.aborted ? '사용자가 중지했습니다.' : `완료 (캡처 ${state.captures}장)`);
    } catch (error) {
      state.state = abort.signal.aborted ? 'stopped' : 'error';
      state.error = abort.signal.aborted ? '' : error instanceof Error ? error.message : String(error);
      log(state, abort.signal.aborted ? '사용자가 중지했습니다.' : `오류: ${state.error}`);
    } finally {
      // `down` 만 하고 끝난 키/버튼이 눌린 채 남지 않도록 놓아 줍니다.
      try {
        for (const button of held.buttons) await nut.mouse.releaseButton(button);
        if (held.keys.size > 0) await nut.keyboard.releaseKey(...held.keys);
      } catch {
        // 정리는 최선 노력
      }
      state.finishedAt = Date.now();
      state.note = '';
      state.stepIndex = -1;
      if (controller === abort) controller = null;
      restoreAppWindows(hidden);
      options.onFinish?.();
    }
  })();

  return structuredClone(state);
}
