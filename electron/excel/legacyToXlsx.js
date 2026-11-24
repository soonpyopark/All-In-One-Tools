/**
 * .xls / .xlt / .xlsb → 임시 .xlsx (Excel COM, 서식 유지).
 * Excel 이 없거나 실패하면 null.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const LEGACY_EXTS = new Set(['.xls', '.xlt', '.xlsb']);

function powershellExe() {
  const root = process.env.SystemRoot || 'C:\\Windows';
  const sys = path.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  if (fs.existsSync(sys)) return sys;
  return 'powershell.exe';
}

function scriptPath() {
  let script = path.join(__dirname, 'legacyToXlsx.ps1');
  if (script.includes(`${path.sep}app.asar${path.sep}`) && !script.includes('app.asar.unpacked')) {
    script = script.replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`);
  }
  return script;
}

/**
 * @param {string} filePath
 */
export function isLegacyExcelPath(filePath) {
  return LEGACY_EXTS.has(path.extname(String(filePath ?? '')).toLowerCase());
}

/**
 * @param {string} inputPath
 * @param {{ timeoutMs?: number }} [opts]
 * @returns {Promise<string | null>} 임시 .xlsx 경로, 실패 시 null
 */
export function convertLegacyExcelToXlsx(inputPath, opts = {}) {
  if (process.platform !== 'win32') return Promise.resolve(null);
  const resolved = path.resolve(String(inputPath ?? '').trim());
  if (!resolved || !fs.existsSync(resolved) || !isLegacyExcelPath(resolved)) {
    return Promise.resolve(null);
  }

  const timeoutMs = Math.max(15_000, Number(opts.timeoutMs) || 120_000);
  const outPath = path.join(os.tmpdir(), `alltools-xls-${randomUUID()}.xlsx`);
  const ps1 = scriptPath();
  if (!fs.existsSync(ps1)) return Promise.resolve(null);

  return new Promise((resolve) => {
    const child = spawn(
      powershellExe(),
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        ps1,
        '-InputPath',
        resolved,
        '-OutputPath',
        outPath,
      ],
      { windowsHide: true },
    );

    let stderr = '';
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // ignore
      }
      try {
        if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
      } catch {
        // ignore
      }
      resolve(null);
    }, timeoutMs);

    child.stderr.on('data', (chunk) => {
      stderr += String(chunk ?? '');
    });

    child.on('error', () => {
      clearTimeout(timer);
      resolve(null);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0 && fs.existsSync(outPath) && fs.statSync(outPath).size > 0) {
        resolve(outPath);
        return;
      }
      try {
        if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
      } catch {
        // ignore
      }
      if (/EXCEL_NOT_INSTALLED/i.test(stderr)) {
        resolve(null);
        return;
      }
      resolve(null);
    });
  });
}

/**
 * 변환 캐시: 같은 레거시 파일을 한 작업에서 여러 번 쓸 때 재사용.
 */
export function createLegacyConvertCache() {
  /** @type {Map<string, Promise<string | null>>} */
  const pending = new Map();
  /** @type {string[]} */
  const temps = [];

  return {
    /**
     * @param {string} filePath
     * @returns {Promise<string>} openxml 경로 (원본 또는 변환본). 실패 시 원본 경로 그대로.
     */
    async resolveOpenXml(filePath) {
      const resolved = path.resolve(String(filePath ?? '').trim());
      if (!isLegacyExcelPath(resolved)) return resolved;
      let job = pending.get(resolved);
      if (!job) {
        job = convertLegacyExcelToXlsx(resolved).then((out) => {
          if (out) temps.push(out);
          return out;
        });
        pending.set(resolved, job);
      }
      const converted = await job;
      return converted || resolved;
    },
    cleanup() {
      for (const item of temps) {
        try {
          if (fs.existsSync(item)) fs.unlinkSync(item);
        } catch {
          // ignore
        }
      }
      temps.length = 0;
      pending.clear();
    },
  };
}
