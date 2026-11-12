import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { statePath } from '../context.js';
import { readJsonSync, withFileLock, writeJsonSync } from '../jsonStore.js';

const CLOCK_FILE = 'alarms.json';
const SOUND_EXTS = new Set(['.wav', '.mp3', '.m4a', '.aac', '.ogg', '.flac', '.wma']);

/**
 * @typedef {{
 *   id: string,
 *   title: string,
 *   time: string,
 *   enabled: boolean,
 *   repeat: 'once' | 'daily',
 *   snoozeUntil: number | null,
 *   lastFiredKey: string,
 * }} AlarmItem
 */

/**
 * @param {unknown} raw
 * @returns {string}
 */
function normalizeTime(raw) {
  const text = String(raw ?? '').trim();
  const m = /^(\d{1,2}):(\d{2})$/.exec(text);
  if (!m) return '';
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return '';
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/**
 * @param {unknown} raw
 * @returns {string}
 */
export function normalizeSoundPath(raw) {
  const value = String(raw ?? '').trim();
  if (!value || value.length > 1024) return '';
  if (/[\u0000-\u001f]/.test(value)) return '';
  const resolved = path.resolve(value);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) return '';
  const ext = path.extname(resolved).toLowerCase();
  if (!SOUND_EXTS.has(ext)) return '';
  return resolved;
}

/**
 * @param {unknown} raw
 * @returns {AlarmItem | null}
 */
function normalizeAlarm(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const src = /** @type {Record<string, unknown>} */ (raw);
  const time = normalizeTime(src.time);
  if (!time) return null;
  const title = String(src.title ?? '').trim().slice(0, 80) || '알람';
  const id =
    typeof src.id === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(src.id) ? src.id : randomUUID();
  const repeat = src.repeat === 'daily' ? 'daily' : 'once';
  const snoozeUntil =
    typeof src.snoozeUntil === 'number' && Number.isFinite(src.snoozeUntil) ? src.snoozeUntil : null;
  const lastFiredKey = typeof src.lastFiredKey === 'string' ? src.lastFiredKey.slice(0, 64) : '';
  return {
    id,
    title,
    time,
    enabled: src.enabled !== false,
    repeat,
    snoozeUntil,
    lastFiredKey,
  };
}

function readClockFile() {
  return readJsonSync(statePath(CLOCK_FILE), { alarms: [], soundPath: '' });
}

/**
 * @param {AlarmItem[]} alarms
 * @param {string} [soundPath]
 */
function writeClockFile(alarms, soundPath) {
  const currentSound =
    soundPath !== undefined ? normalizeSoundPath(soundPath) || String(soundPath || '').trim() : getSoundPathUnlocked();
  writeJsonSync(statePath(CLOCK_FILE), {
    version: 1,
    soundPath: currentSound && fs.existsSync(currentSound) ? currentSound : '',
    alarms,
  });
}

function getSoundPathUnlocked() {
  const raw = readClockFile();
  return normalizeSoundPath(raw?.soundPath);
}

/** @returns {AlarmItem[]} */
export function listAlarms() {
  const raw = readClockFile();
  const list = Array.isArray(raw?.alarms) ? raw.alarms : [];
  /** @type {AlarmItem[]} */
  const out = [];
  const seen = new Set();
  for (const item of list) {
    const next = normalizeAlarm(item);
    if (!next || seen.has(next.id)) continue;
    seen.add(next.id);
    out.push(next);
    if (out.length >= 100) break;
  }
  return out;
}

function listAlarmsUnlocked() {
  return listAlarms();
}

/** @returns {string} */
export function getSoundPath() {
  return getSoundPathUnlocked();
}

/**
 * @param {string} soundPath
 * @returns {Promise<string>}
 */
export function setSoundPath(soundPath) {
  return withFileLock(statePath(CLOCK_FILE), () => {
    const next = normalizeSoundPath(soundPath);
    if (soundPath && !next) throw new Error('지원하지 않는 파일이거나 찾을 수 없습니다. (wav, mp3, m4a, aac, ogg, flac)');
    writeClockFile(listAlarmsUnlocked(), next);
    return next;
  });
}

/**
 * @param {unknown[]} alarms
 * @returns {Promise<AlarmItem[]>}
 */
export function saveAlarms(alarms) {
  return withFileLock(statePath(CLOCK_FILE), () => {
    const list = Array.isArray(alarms) ? alarms : [];
    /** @type {AlarmItem[]} */
    const next = [];
    const seen = new Set();
    for (const item of list) {
      const normalized = normalizeAlarm(item);
      if (!normalized || seen.has(normalized.id)) continue;
      seen.add(normalized.id);
      next.push(normalized);
      if (next.length >= 100) break;
    }
    writeClockFile(next);
    return next;
  });
}

/**
 * @param {unknown} raw
 * @returns {Promise<AlarmItem[]>}
 */
export function upsertAlarm(raw) {
  return withFileLock(statePath(CLOCK_FILE), () => {
    const item = normalizeAlarm(raw);
    if (!item) throw new Error('알람 정보가 올바르지 않습니다. (HH:MM)');
    const current = listAlarmsUnlocked();
    const index = current.findIndex((entry) => entry.id === item.id);
    if (index >= 0) current[index] = item;
    else current.push(item);
    writeClockFile(current);
    return current;
  });
}

/**
 * @param {string} id
 * @returns {Promise<AlarmItem[]>}
 */
export function removeAlarm(id) {
  return withFileLock(statePath(CLOCK_FILE), () => {
    const next = listAlarmsUnlocked().filter((item) => item.id !== id);
    writeClockFile(next);
    return next;
  });
}

/**
 * @param {string} id
 * @param {(alarm: AlarmItem) => AlarmItem} mutator
 * @returns {Promise<AlarmItem[]>}
 */
export function patchAlarm(id, mutator) {
  return withFileLock(statePath(CLOCK_FILE), () => {
    const current = listAlarmsUnlocked();
    const index = current.findIndex((entry) => entry.id === id);
    if (index < 0) throw new Error('알람을 찾을 수 없습니다.');
    const nextItem = normalizeAlarm(mutator(current[index]));
    if (!nextItem) throw new Error('알람 정보가 올바르지 않습니다.');
    current[index] = nextItem;
    writeClockFile(current);
    return current;
  });
}

export { normalizeTime, SOUND_EXTS };