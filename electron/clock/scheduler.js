import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { Notification } from 'electron';
import { APP_NAME } from '../../shared/constants.js';
import { showMainWindow } from '../trayService.js';
import { getSoundPath, listAlarms, patchAlarm, saveAlarms } from './store.js';

/**
 * @typedef {{
 *   running: boolean,
 *   remainingMs: number,
 *   durationMs: number,
 *   endsAt: number | null,
 * }} TimerState
 */

/**
 * @typedef {{
 *   kind: 'alarm' | 'timer',
 *   id: string,
 *   title: string,
 *   firedAt: number,
 * }} RingEvent
 */

/** @type {TimerState} */
let timer = {
  running: false,
  remainingMs: 0,
  durationMs: 0,
  endsAt: null,
};

/** @type {RingEvent | null} */
let ringing = null;

/** @type {ReturnType<typeof setInterval> | null} */
let tickTimer = null;

/** @type {import('node:child_process').ChildProcess | null} */
let soundProcess = null;

function stopSound() {
  if (!soundProcess) return;
  try {
    soundProcess.kill();
  } catch {
    // ignore
  }
  soundProcess = null;
}

function defaultBeep() {
  if (process.platform === 'win32') {
    try {
      const child = spawn(
        'powershell.exe',
        ['-NoProfile', '-Command', '[console]::beep(880,350); Start-Sleep -Milliseconds 120; [console]::beep(988,350)'],
        { windowsHide: true, stdio: 'ignore' },
      );
      child.unref();
    } catch {
      // ignore
    }
    return;
  }
  if (process.platform === 'darwin') {
    try {
      const child = spawn('afplay', ['/System/Library/Sounds/Glass.aiff'], { stdio: 'ignore' });
      child.unref();
    } catch {
      // ignore
    }
  }
}

/**
 * 사용자 음원 재생. 없거나 실패하면 기본 비프.
 * @param {string} [filePath]
 */
function playSound(filePath) {
  stopSound();
  const target = String(filePath || getSoundPath() || '').trim();
  if (!target || !fs.existsSync(target)) {
    defaultBeep();
    return;
  }

  try {
    if (process.platform === 'darwin') {
      soundProcess = spawn('afplay', [target], { stdio: 'ignore' });
    } else if (process.platform === 'win32') {
      const escaped = target.replace(/'/g, "''");
      soundProcess = spawn(
        'powershell.exe',
        [
          '-NoProfile',
          '-Command',
          [
            'Add-Type -AssemblyName presentationCore;',
            '$p = New-Object System.Windows.Media.MediaPlayer;',
            `$path = (Resolve-Path -LiteralPath '${escaped}').Path;`,
            '$p.Open([System.Uri]::new($path));',
            'Start-Sleep -Milliseconds 250;',
            '$p.Volume = 1;',
            '$p.Play();',
            '$deadline = (Get-Date).AddSeconds(45);',
            'do {',
            '  Start-Sleep -Milliseconds 200;',
            '  if ($p.NaturalDuration.HasTimeSpan -and $p.Position -ge $p.NaturalDuration.TimeSpan) { break }',
            '} while ((Get-Date) -lt $deadline);',
            '$p.Stop();',
            '$p.Close();',
          ].join(' '),
        ],
        { windowsHide: true, stdio: 'ignore' },
      );
    } else {
      soundProcess = spawn('ffplay', ['-nodisp', '-autoexit', '-loglevel', 'quiet', target], { stdio: 'ignore' });
    }
    soundProcess.on('exit', () => {
      soundProcess = null;
    });
    soundProcess.on('error', () => {
      soundProcess = null;
      defaultBeep();
    });
  } catch {
    defaultBeep();
  }
}

/**
 * @param {RingEvent} event
 */
function fireRing(event) {
  ringing = event;
  playSound();
  try {
    if (Notification.isSupported()) {
      const note = new Notification({
        title: event.kind === 'timer' ? `${APP_NAME} · 타이머` : `${APP_NAME} · 알람`,
        body: event.title || (event.kind === 'timer' ? '시간이 되었습니다.' : '알람'),
      });
      note.on('click', () => {
        showMainWindow();
      });
      note.show();
    }
  } catch {
    // 알림 실패해도 상태·소리는 유지
  }
  showMainWindow();
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function nowParts(date = new Date()) {
  return {
    hhmm: `${pad(date.getHours())}:${pad(date.getMinutes())}`,
    dayKey: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    ms: date.getTime(),
  };
}

async function checkAlarms() {
  const { hhmm, dayKey, ms } = nowParts();
  const alarms = listAlarms();
  let changed = false;
  /** @type {import('./store.js').AlarmItem[]} */
  const next = [];

  for (const alarm of alarms) {
    let current = { ...alarm };

    if (current.snoozeUntil && current.snoozeUntil <= ms) {
      const fireKey = `snooze:${current.snoozeUntil}`;
      if (current.lastFiredKey !== fireKey) {
        current = { ...current, snoozeUntil: null, lastFiredKey: fireKey };
        changed = true;
        fireRing({ kind: 'alarm', id: current.id, title: current.title, firedAt: ms });
        if (current.repeat === 'once') {
          current = { ...current, enabled: false };
        }
      }
    } else if (current.enabled && !current.snoozeUntil && current.time === hhmm) {
      const fireKey = `${dayKey}:${current.time}`;
      if (current.lastFiredKey !== fireKey) {
        current = { ...current, lastFiredKey: fireKey };
        changed = true;
        fireRing({ kind: 'alarm', id: current.id, title: current.title, firedAt: ms });
        if (current.repeat === 'once') {
          current = { ...current, enabled: false };
        }
      }
    }

    next.push(current);
  }

  if (changed) await saveAlarms(next);
}

function checkTimer() {
  if (!timer.running || !timer.endsAt) return;
  const left = timer.endsAt - Date.now();
  if (left > 0) {
    timer = { ...timer, remainingMs: left };
    return;
  }
  timer = {
    running: false,
    remainingMs: 0,
    durationMs: timer.durationMs,
    endsAt: null,
  };
  fireRing({
    kind: 'timer',
    id: 'timer',
    title: '타이머가 끝났습니다.',
    firedAt: Date.now(),
  });
}

function tick() {
  void checkAlarms().catch(() => undefined);
  checkTimer();
}

export function startClockScheduler() {
  if (tickTimer) return;
  tick();
  tickTimer = setInterval(tick, 1000);
  if (typeof tickTimer.unref === 'function') tickTimer.unref();
}

export function stopClockScheduler() {
  if (!tickTimer) return;
  clearInterval(tickTimer);
  tickTimer = null;
}

export function getTimerState() {
  if (timer.running && timer.endsAt) {
    return {
      ...timer,
      remainingMs: Math.max(0, timer.endsAt - Date.now()),
    };
  }
  return { ...timer };
}

/**
 * @param {number} seconds
 */
export function startTimer(seconds) {
  const sec = Math.max(1, Math.min(24 * 60 * 60, Math.floor(seconds)));
  const durationMs = sec * 1000;
  timer = {
    running: true,
    remainingMs: durationMs,
    durationMs,
    endsAt: Date.now() + durationMs,
  };
  return getTimerState();
}

export function pauseTimer() {
  if (!timer.running) return getTimerState();
  const remainingMs = Math.max(0, (timer.endsAt ?? Date.now()) - Date.now());
  timer = {
    running: false,
    remainingMs,
    durationMs: timer.durationMs,
    endsAt: null,
  };
  return getTimerState();
}

export function resumeTimer() {
  if (timer.running || timer.remainingMs <= 0) return getTimerState();
  timer = {
    running: true,
    remainingMs: timer.remainingMs,
    durationMs: timer.durationMs || timer.remainingMs,
    endsAt: Date.now() + timer.remainingMs,
  };
  return getTimerState();
}

export function resetTimer() {
  timer = {
    running: false,
    remainingMs: 0,
    durationMs: 0,
    endsAt: null,
  };
  return getTimerState();
}

export function getRinging() {
  return ringing;
}

export function dismissRinging() {
  stopSound();
  ringing = null;
  return { ok: true };
}

/**
 * @param {number} minutes
 */
export async function snoozeRinging(minutes = 5) {
  const current = ringing;
  stopSound();
  if (!current || current.kind !== 'alarm') {
    ringing = null;
    return { ok: true, ringing: null };
  }
  const mins = Math.max(1, Math.min(60, Math.floor(minutes)));
  await patchAlarm(current.id, (alarm) => ({
    ...alarm,
    enabled: true,
    snoozeUntil: Date.now() + mins * 60_000,
  }));
  ringing = null;
  return { ok: true };
}

/** 미리듣기 */
export function previewSound() {
  playSound();
  return { ok: true, soundPath: getSoundPath() };
}

export function stopPreviewSound() {
  stopSound();
  return { ok: true };
}

export function getClockStatus() {
  return {
    timer: getTimerState(),
    ringing,
    soundPath: getSoundPath(),
    serverNow: Date.now(),
  };
}

export { playSound, stopSound };