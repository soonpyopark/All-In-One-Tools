import { api } from './apiClient.js';

/** @param {string} filePath */
function fileName(filePath) {
  const normalized = String(filePath ?? '').replace(/\\/g, '/');
  const parts = normalized.split('/');
  return parts[parts.length - 1] || filePath;
}

/** @param {string} filePath */
function pathKey(filePath) {
  return String(filePath ?? '').replace(/\\/g, '/').toLowerCase();
}

/**
 * 작업 시작 전 암호 PDF마다 비밀번호를 받습니다.
 *
 * @param {string[]} inputPaths
 * @param {{
 *   prompt: (options: any) => Promise<{ action: 'ok' | 'skip' | 'cancel', value: string }>,
 *   alert?: (options: any) => Promise<void>,
 * }} dialog
 * @returns {Promise<{ cancelled: boolean, paths: string[], passwords: Record<string, string> }>}
 */
export async function collectPdfPasswords(inputPaths, dialog) {
  const list = (Array.isArray(inputPaths) ? inputPaths : [])
    .map((item) => String(item ?? '').trim())
    .filter(Boolean);
  if (list.length === 0) {
    return { cancelled: false, paths: [], passwords: {} };
  }

  const probe = await api('pdf.passwords.probe', { paths: list });
  /** @type {Record<string, string>} */
  const passwords = {};
  /** @type {string[]} */
  const accepted = Array.isArray(probe?.unlocked) ? [...probe.unlocked] : [];

  for (const lockedPath of Array.isArray(probe?.locked) ? probe.locked : []) {
    let hint = '이 PDF는 비밀번호가 필요합니다.';
    for (;;) {
      const res = await dialog.prompt({
        title: 'PDF 비밀번호',
        body: `${fileName(lockedPath)}\n${hint}`,
        placeholder: '비밀번호',
        confirmLabel: '확인',
        cancelLabel: '작업 취소',
        extraLabel: '이 파일 건너뛰기',
        inputType: 'password',
      });
      if (res.action === 'cancel') {
        return { cancelled: true, paths: [], passwords: {} };
      }
      if (res.action === 'skip') break;

      const verify = await api('pdf.passwords.verify', {
        path: lockedPath,
        password: res.value,
      });
      if (verify?.ok) {
        passwords[lockedPath] = res.value;
        accepted.push(lockedPath);
        break;
      }
      hint = verify?.error || '비밀번호가 올바르지 않습니다. 다시 입력해 주세요.';
    }
  }

  const acceptedByKey = new Map(accepted.map((item) => [pathKey(item), item]));
  /** @type {string[]} */
  const ordered = [];
  const used = new Set();
  for (const raw of list) {
    const key = pathKey(raw);
    const hit = acceptedByKey.get(key);
    if (hit && !used.has(key)) {
      ordered.push(hit);
      used.add(key);
    }
  }
  for (const item of accepted) {
    const key = pathKey(item);
    if (!used.has(key)) {
      ordered.push(item);
      used.add(key);
    }
  }

  return { cancelled: false, paths: ordered, passwords };
}
