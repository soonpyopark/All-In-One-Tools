/**
 * 32비트 PowerShell 로 한글 COM 병합을 실행합니다.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { hangulAvailability } from './findHangul.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** asar 안에서는 -File 로 .ps1 을 실행할 수 없어 unpacked 경로를 씁니다. */
function mergeScriptPath() {
  let script = path.join(__dirname, 'merge.ps1');
  if (script.includes(`${path.sep}app.asar${path.sep}`) && !script.includes('app.asar.unpacked')) {
    script = script.replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`);
  }
  return script;
}

const MSG_NOT_WINDOWS = 'HWP/HWPX 병합은 Windows에서만 사용할 수 있습니다.';
const MSG_NOT_INSTALLED =
  '한컴 한글(한컴오피스)이 설치되어 있지 않습니다.\n\nHWP/HWPX를 병합하려면 한컴 한글이 필요합니다.';
const MSG_AUTOMATION =
  '한컴 한글은 설치되어 있지만 병합에 실패했습니다.\n\n다음을 확인한 뒤 다시 시도해 주세요.\n• 한컴 한글을 한 번 실행해 초기 설정을 완료했는지\n• 파일이 암호로 보호되어 있지 않은지\n• 다른 프로그램에서 해당 파일을 열고 있지 않은지';

/** @returns {string} */
function powershell32() {
  const root = process.env.SystemRoot || 'C:\\Windows';
  const wow = path.join(root, 'SysWOW64', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  if (fs.existsSync(wow)) return wow;
  return path.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

/**
 * @param {string} name
 * @returns {string}
 */
export function sanitizeMergeName(name) {
  let base = String(name ?? '').trim() || '병합';
  base = base.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim();
  return base || '병합';
}

/**
 * @param {string} filePath
 * @returns {boolean}
 */
export function isHangulDoc(filePath) {
  const ext = path.extname(String(filePath || '')).toLowerCase();
  return ext === '.hwp' || ext === '.hwpx';
}

/**
 * @param {string[]} paths
 * @param {string} outputDir
 * @param {string} outputName 확장자 없는 이름
 * @returns {string}
 */
export function resolveOutputPath(paths, outputDir, outputName) {
  const first = String(paths[0] || '');
  const ext = path.extname(first).toLowerCase() === '.hwp' ? '.hwp' : '.hwpx';
  const folder = String(outputDir || '').trim() || path.dirname(first);
  const stem = sanitizeMergeName(outputName);
  return path.join(folder, `${stem}${ext}`);
}

/**
 * @param {{
 *   paths: string[],
 *   outputPath: string,
 *   timeoutMs?: number,
 *   onProgress?: (info: { index: number, total: number, name: string }) => void,
 * }} options
 * @returns {Promise<{ outputPath: string }>}
 */
export function runHangulMerge(options) {
  const avail = hangulAvailability();
  if (!avail.windows) {
    return Promise.reject(new Error(MSG_NOT_WINDOWS));
  }
  if (!avail.installed) {
    return Promise.reject(new Error(MSG_NOT_INSTALLED));
  }

  const paths = (Array.isArray(options.paths) ? options.paths : [])
    .map((item) => String(item ?? '').trim())
    .filter(Boolean);
  if (paths.length < 2) {
    return Promise.reject(new Error('병합하려면 한글 파일이 2개 이상 필요합니다.'));
  }
  for (const item of paths) {
    if (!isHangulDoc(item)) {
      return Promise.reject(new Error(`HWP/HWPX 파일이 아닙니다: ${path.basename(item)}`));
    }
    if (!fs.existsSync(item) || !fs.statSync(item).isFile()) {
      return Promise.reject(new Error(`파일을 찾을 수 없습니다: ${path.basename(item)}`));
    }
  }

  const outputPath = path.resolve(String(options.outputPath || '').trim());
  if (!outputPath) {
    return Promise.reject(new Error('저장 경로가 없습니다.'));
  }

  const payload = { paths, outputPath };
  const payloadPath = path.join(
    os.tmpdir(),
    `alltools-hwp-merge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`,
  );
  fs.writeFileSync(payloadPath, JSON.stringify(payload), 'utf8');

  const timeoutMs = Math.max(60_000, Number(options.timeoutMs) || 10 * 60_000);
  const ps = powershell32();
  const total = paths.length;
  const scriptPath = mergeScriptPath();
  if (!fs.existsSync(scriptPath)) {
    return Promise.reject(new Error('병합 스크립트를 찾을 수 없습니다. 앱을 다시 설치해 주세요.'));
  }

  return new Promise((resolve, reject) => {
    const child = spawn(
      ps,
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        scriptPath,
        '-PayloadPath',
        payloadPath,
      ],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
    );

    let stdout = '';
    let stderr = '';
    let settled = false;
    let lastError = '';
    let donePath = '';

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        child.kill();
      } catch {
        /* ignore */
      }
      cleanup();
      reject(new Error('병합 시간이 초과되었습니다. 한컴 한글이 응답하는지 확인해 주세요.'));
    }, timeoutMs);

    const cleanup = () => {
      try {
        fs.unlinkSync(payloadPath);
      } catch {
        /* ignore */
      }
    };

    const handleLine = (line) => {
      const text = String(line || '').trim();
      if (!text) return;
      if (text.startsWith('PROGRESS ')) {
        const rest = text.slice('PROGRESS '.length);
        const match = rest.match(/^(\d+)\/(\d+)\s+(.*)$/);
        if (match && typeof options.onProgress === 'function') {
          options.onProgress({
            index: Number(match[1]) || 0,
            total: Number(match[2]) || total,
            name: match[3] || '',
          });
        }
        return;
      }
      if (text.startsWith('DONE ')) {
        donePath = text.slice('DONE '.length).trim();
        return;
      }
      if (text.startsWith('ERROR ')) {
        lastError = text.slice('ERROR '.length).trim();
      }
    };

    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk);
      const parts = stdout.split(/\r?\n/);
      stdout = parts.pop() || '';
      for (const line of parts) handleLine(line);
    });
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
      reject(new Error(err instanceof Error ? err.message : String(err)));
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (stdout.trim()) handleLine(stdout);
      cleanup();

      if (code === 0 && (donePath || fs.existsSync(outputPath))) {
        const finalPath = donePath || outputPath;
        if (!fs.existsSync(finalPath) || fs.statSync(finalPath).size <= 0) {
          reject(new Error(MSG_AUTOMATION));
          return;
        }
        resolve({ outputPath: finalPath });
        return;
      }

      const detail = lastError || stderr.trim() || stdout.trim();
      if (/HANCOM_COM/i.test(detail)) {
        reject(new Error(MSG_AUTOMATION));
        return;
      }
      reject(new Error(detail || MSG_AUTOMATION));
    });
  });
}

export { MSG_NOT_INSTALLED, MSG_NOT_WINDOWS, MSG_AUTOMATION };
