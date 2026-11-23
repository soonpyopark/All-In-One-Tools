/**
 * 한컴 한글(Hwp.exe) 설치 여부·경로 탐지 (Windows).
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

/**
 * @param {string} root
 * @param {string} subkey
 * @param {string} name
 * @returns {string}
 */
function readRegString(root, subkey, name) {
  if (process.platform !== 'win32') return '';
  try {
    const result = spawnSync(
      'reg',
      ['query', `${root}\\${subkey}`, '/v', name],
      { encoding: 'utf8', windowsHide: true, timeout: 8_000 },
    );
    if (result.status !== 0) return '';
    const text = String(result.stdout || '');
    const match = text.match(/REG_(?:SZ|EXPAND_SZ)\s+(.+)$/m);
    return match ? String(match[1]).trim() : '';
  } catch {
    return '';
  }
}

/**
 * @returns {string | null} Hwp.exe 절대 경로
 */
export function findHwpExe() {
  if (process.platform !== 'win32') return null;

  /** @type {string[]} */
  const roots = [];
  for (const [hive, sub, name] of [
    ['HKLM', 'SOFTWARE\\WOW6432Node\\HNC\\Shared', 'Hnc Path130'],
    ['HKLM', 'SOFTWARE\\HNC\\Shared', 'Hnc Path130'],
    ['HKLM', 'SOFTWARE\\WOW6432Node\\HNC\\Shared', 'Hnc Path120'],
    ['HKLM', 'SOFTWARE\\WOW6432Node\\HNC\\Shared', 'Hnc Path110'],
  ]) {
    const value = readRegString(hive, sub, name);
    if (value) roots.push(value);
  }

  for (const root of roots) {
    for (const rel of [
      ['HOffice130', 'Bin', 'Hwp.exe'],
      ['HOffice120', 'Bin', 'Hwp.exe'],
      ['HOffice110', 'Bin', 'Hwp.exe'],
      ['Bin', 'Hwp.exe'],
    ]) {
      const candidate = path.join(root, ...rel);
      if (fs.existsSync(candidate)) return candidate;
    }
  }

  const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  for (const rel of [
    'Hnc\\Office 2024\\HOffice130\\Bin\\Hwp.exe',
    'HNC\\Office 2024\\HOffice130\\Bin\\Hwp.exe',
    'Hnc\\Office 2022\\HOffice120\\Bin\\Hwp.exe',
    'Hnc\\Office 2020\\HOffice110\\Bin\\Hwp.exe',
  ]) {
    const candidate = path.join(pf86, rel);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/** @returns {{ windows: boolean, installed: boolean, hwpExe: string | null }} */
export function hangulAvailability() {
  const windows = process.platform === 'win32';
  if (!windows) return { windows: false, installed: false, hwpExe: null };
  const hwpExe = findHwpExe();
  return { windows: true, installed: Boolean(hwpExe), hwpExe };
}
