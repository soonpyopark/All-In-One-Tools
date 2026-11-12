/**
 * 시간 & 알람 API.
 */
import fs from 'node:fs';
import path from 'node:path';
import { BrowserWindow, app, dialog } from 'electron';
import { APP_NAME } from '../../shared/constants.js';
import { ApiError, defineApi } from '../api/registry.js';
import {
  dismissRinging,
  getClockStatus,
  getTimerState,
  pauseTimer,
  previewSound,
  resetTimer,
  resumeTimer,
  snoozeRinging,
  startClockScheduler,
  startTimer,
  stopPreviewSound,
} from '../clock/scheduler.js';
import {
  getSoundPath,
  listAlarms,
  removeAlarm,
  saveAlarms,
  setSoundPath,
  upsertAlarm,
  SOUND_EXTS,
} from '../clock/store.js';

const BACKUP_KIND = 'all-tools-alarms';

/** @returns {import('electron').BrowserWindow | null} */
function appMainWindow() {
  const wins = BrowserWindow.getAllWindows().filter((win) => !win.isDestroyed());
  return (
    wins.find((win) => win.getTitle().startsWith(APP_NAME) && !win.isFullScreen()) ??
    wins.find((win) => !win.isFullScreen()) ??
    null
  );
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${String(d.getFullYear()).slice(2)}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export function register() {
  startClockScheduler();

  defineApi('clock.status', () => getClockStatus());

  defineApi('clock.alarms.list', () => ({ alarms: listAlarms() }));

  defineApi('clock.alarms.upsert', async (body) => {
    try {
      const alarms = await upsertAlarm(body?.alarm ?? body);
      return { alarms };
    } catch (err) {
      throw new ApiError(err instanceof Error ? err.message : String(err));
    }
  });

  defineApi('clock.alarms.remove', async (body) => {
    const id = String(body?.id ?? '');
    if (!id) throw new ApiError('삭제할 알람이 없습니다.');
    const alarms = await removeAlarm(id);
    return { alarms };
  });

  defineApi('clock.alarms.export', async () => {
    const alarms = listAlarms();
    const win = appMainWindow();
    const result = await dialog.showSaveDialog(win ?? undefined, {
      title: '알람 목록 내보내기',
      defaultPath: path.join(app.getPath('documents'), `AllTools_alarms_${stamp()}.json`),
      filters: [{ name: '알람 목록 (JSON)', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) return { cancelled: true };

    let filePath = result.filePath;
    if (!/\.json$/i.test(filePath)) filePath = `${filePath}.json`;

    const payload = {
      version: 1,
      kind: BACKUP_KIND,
      exportedAt: new Date().toISOString(),
      alarms,
    };
    try {
      fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
      return { ok: true, filePath, count: alarms.length };
    } catch (err) {
      throw new ApiError(err instanceof Error ? err.message : '내보내기에 실패했습니다.');
    }
  });

  defineApi('clock.alarms.import', async (body) => {
    const mode = body?.mode === 'merge' ? 'merge' : 'replace';
    const win = appMainWindow();
    const result = await dialog.showOpenDialog(win ?? undefined, {
      title: '알람 목록 가져오기',
      properties: ['openFile'],
      filters: [{ name: '알람 목록 (JSON)', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePaths[0]) return { cancelled: true };

    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(result.filePaths[0], 'utf8'));
    } catch {
      throw new ApiError('파일을 읽을 수 없습니다. JSON 형식인지 확인하세요.');
    }

    const rawAlarms = Array.isArray(parsed?.alarms)
      ? parsed.alarms
      : Array.isArray(parsed)
        ? parsed
        : null;
    if (!rawAlarms) throw new ApiError('알람 목록 형식이 아닙니다. (alarms 배열 필요)');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && parsed.kind && parsed.kind !== BACKUP_KIND) {
      throw new ApiError('All In One Tools 알람 목록 파일이 아닙니다.');
    }

    /** @type {unknown[]} */
    let nextRaw = rawAlarms;
    if (mode === 'merge') {
      const current = listAlarms();
      const seen = new Set(current.map((item) => `${item.time}\0${item.title}\0${item.repeat}`));
      const merged = [...current];
      for (const item of rawAlarms) {
        if (!item || typeof item !== 'object') continue;
        const row = /** @type {Record<string, unknown>} */ (item);
        const time = String(row.time ?? '').trim();
        const title = String(row.title ?? '').trim();
        const repeat = row.repeat === 'daily' ? 'daily' : 'once';
        const key = `${time}\0${title}\0${repeat}`;
        if (!time || seen.has(key)) continue;
        seen.add(key);
        merged.push({ ...row, id: undefined, snoozeUntil: null, lastFiredKey: '' });
      }
      nextRaw = merged;
    }

    const alarms = await saveAlarms(nextRaw);
    return { ok: true, mode, count: alarms.length, alarms };
  });

  defineApi('clock.timer.get', () => ({ timer: getTimerState() }));

  defineApi('clock.timer.start', (body) => {
    const seconds = Number(body?.seconds);
    if (!Number.isFinite(seconds) || seconds < 1) {
      throw new ApiError('1초 이상의 시간을 입력하세요.');
    }
    return { timer: startTimer(seconds) };
  });

  defineApi('clock.timer.pause', () => ({ timer: pauseTimer() }));

  defineApi('clock.timer.resume', () => ({ timer: resumeTimer() }));

  defineApi('clock.timer.reset', () => ({ timer: resetTimer() }));

  defineApi('clock.dismiss', () => dismissRinging());

  defineApi('clock.snooze', async (body) => {
    const minutes = Number(body?.minutes ?? 5);
    return snoozeRinging(Number.isFinite(minutes) ? minutes : 5);
  });

  defineApi('clock.sound.get', () => ({ soundPath: getSoundPath() }));

  defineApi('clock.sound.pick', async () => {
    const win = appMainWindow();
    const extensions = [...SOUND_EXTS].map((ext) => ext.replace(/^\./, ''));
    const result = await dialog.showOpenDialog(win ?? undefined, {
      title: '알람 · 타이머 음원 선택',
      properties: ['openFile'],
      filters: [
        { name: '오디오', extensions },
        { name: '모든 파일', extensions: ['*'] },
      ],
    });
    if (result.canceled || !result.filePaths[0]) return { cancelled: true, soundPath: getSoundPath() };
    try {
      const soundPath = await setSoundPath(result.filePaths[0]);
      return { ok: true, soundPath };
    } catch (err) {
      throw new ApiError(err instanceof Error ? err.message : '음원을 설정하지 못했습니다.');
    }
  });

  defineApi('clock.sound.clear', async () => {
    const soundPath = await setSoundPath('');
    stopPreviewSound();
    return { ok: true, soundPath };
  });

  defineApi('clock.sound.preview', () => previewSound());

  defineApi('clock.sound.stopPreview', () => stopPreviewSound());
}