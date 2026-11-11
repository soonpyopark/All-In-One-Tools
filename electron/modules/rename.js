import fs from 'node:fs';
import path from 'node:path';
import { ApiError, defineApi } from '../api/registry.js';
import { invalidNameReason } from '../../shared/renameRules.js';

const fsp = fs.promises;
/** 폴더 안(하위 포함) 파일을 한 번에 읽어 오는 최대 개수. */
const MAX_LIST_FILES = 20000;
/** 한 번에 오류 메시지에 나열하는 최대 줄 수. */
const MAX_ERROR_LINES = 12;
/** Windows·macOS 파일 시스템은 대소문자를 구분하지 않으므로 비교 키를 소문자로 만듭니다. */
const CASE_INSENSITIVE = process.platform === 'win32' || process.platform === 'darwin';

const pathKey = (p) => (CASE_INSENSITIVE ? path.resolve(p).toLowerCase() : path.resolve(p));

/** 화면에 보낼 파일 정보. */
function fileInfo(filePath) {
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) return null;
  return {
    path: filePath,
    dir: path.dirname(filePath),
    name: path.basename(filePath),
    size: stat.size,
    mtimeMs: stat.mtimeMs,
  };
}

/** 폴더 안 파일 경로들 (하위 폴더 포함 여부 선택). 읽을 수 없는 폴더는 건너뜁니다. */
function collectFiles(root, recursive) {
  /** @type {string[]} */
  const files = [];
  const stack = [root];
  let truncated = false;
  while (stack.length > 0 && !truncated) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isFile()) {
        files.push(full);
        if (files.length >= MAX_LIST_FILES) {
          truncated = true;
          break;
        }
      } else if (recursive && entry.isDirectory()) {
        stack.push(full);
      }
    }
  }
  return { files, truncated };
}

/** 같은 볼륨이면 rename, 다른 볼륨이면 복사 후 삭제. 대상이 이미 있으면 덮어쓰지 않고 실패합니다. */
async function moveFile(from, to) {
  if (fs.existsSync(to)) throw new Error('같은 이름의 파일이 이미 있습니다.');
  try {
    await fsp.rename(from, to);
  } catch (err) {
    if (err?.code !== 'EXDEV') throw err;
    await fsp.copyFile(from, to, fs.constants.COPYFILE_EXCL);
    await fsp.unlink(from);
  }
}

/**
 * 요청 항목을 검증해 실행 계획을 만듭니다. 문제가 있으면 줄 단위 메시지를 돌려줍니다.
 *
 * @param {unknown} rawItems
 */
function plan(rawItems) {
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    throw new ApiError('바꿀 항목이 없습니다.');
  }
  /** @type {{ from: string, to: string, toDir: string, toName: string }[]} */
  const entries = [];
  /** @type {string[]} */
  const problems = [];

  for (const raw of rawItems) {
    const from = path.resolve(String(raw?.from ?? ''));
    const toDir = path.resolve(String(raw?.toDir ?? ''));
    const toName = String(raw?.toName ?? '');
    const label = path.basename(from);

    const reason = invalidNameReason(toName);
    if (reason) {
      problems.push(`${label} → "${toName}": ${reason}`);
      continue;
    }
    let stat = null;
    try {
      stat = fs.statSync(from);
    } catch {
      /* 아래에서 처리 */
    }
    if (!stat?.isFile()) {
      problems.push(`${label}: 원본 파일을 찾을 수 없습니다.`);
      continue;
    }
    let dirStat = null;
    try {
      dirStat = fs.statSync(toDir);
    } catch {
      /* 아래에서 처리 */
    }
    if (!dirStat?.isDirectory()) {
      problems.push(`${label}: 대상 폴더를 찾을 수 없습니다. (${toDir})`);
      continue;
    }
    entries.push({ from, to: path.join(toDir, toName), toDir, toName });
  }

  // 이동·이름 변경으로 새 위치가 같아지는 경우
  const targetKeys = new Map();
  for (const entry of entries) {
    const key = pathKey(entry.to);
    if (targetKeys.has(key)) {
      problems.push(`${entry.toName}: 같은 위치에 같은 이름이 둘 이상 생깁니다.`);
    }
    targetKeys.set(key, entry);
  }

  // 이미 있는 다른 파일과 겹치는 경우 (이번에 같이 옮겨지는 파일이면 괜찮음)
  const sourceKeys = new Set(entries.map((entry) => pathKey(entry.from)));
  for (const entry of entries) {
    const key = pathKey(entry.to);
    if (sourceKeys.has(key)) continue;
    if (fs.existsSync(entry.to)) {
      problems.push(`${entry.toName}: 대상 위치에 같은 이름의 파일이 이미 있습니다.`);
    }
  }

  if (problems.length > 0) {
    const shown = problems.slice(0, MAX_ERROR_LINES);
    const more = problems.length - shown.length;
    throw new ApiError(
      `이름을 바꿀 수 없는 항목이 있어 아무것도 바꾸지 않았습니다.\n\n${shown.join('\n')}${
        more > 0 ? `\n…외 ${more}건` : ''
      }`,
    );
  }

  // 실제로 바뀌는 것만 (대소문자만 바뀌는 경우도 포함)
  return entries.filter((entry) => entry.from !== entry.to);
}

export function register() {
  /**
   * 파일·폴더 경로를 받아 파일 정보(크기·수정 시각 포함)로 바꿔 줍니다.
   * 폴더는 안의 파일을 자연 정렬로 펼치고(`recursive` 면 하위 폴더까지), 읽을 수 없는 경로는 건너뜁니다.
   */
  defineApi('rename.inspect', (body) => {
    const paths = Array.isArray(body?.paths) ? body.paths : [];
    const recursive = body?.recursive === true;
    const collator = new Intl.Collator('ko', { numeric: true, sensitivity: 'base' });
    const files = [];
    let skipped = 0;
    let truncated = false;
    for (const raw of paths) {
      const target = path.resolve(String(raw));
      try {
        const stat = fs.statSync(target);
        if (stat.isDirectory()) {
          const found = collectFiles(target, recursive);
          truncated = truncated || found.truncated;
          found.files.sort((a, b) => collator.compare(a, b));
          for (const file of found.files) {
            try {
              const info = fileInfo(file);
              if (info) files.push(info);
            } catch {
              skipped += 1;
            }
          }
        } else {
          const info = fileInfo(target);
          if (info) files.push(info);
          else skipped += 1;
        }
      } catch {
        skipped += 1;
      }
    }
    return { files, skipped, truncated };
  });

  /** 폴더 안 파일 목록 (옵션: 하위 폴더 포함), 자연 정렬. */
  defineApi('rename.listFolder', (body) => {
    const dir = path.resolve(String(body?.dirPath ?? '').trim());
    try {
      if (!fs.statSync(dir).isDirectory()) throw new Error('not a directory');
    } catch {
      throw new ApiError(`폴더를 열 수 없습니다.\n${dir}`);
    }
    const { files, truncated } = collectFiles(dir, body?.recursive === true);
    const collator = new Intl.Collator('ko', { numeric: true, sensitivity: 'base' });
    files.sort((a, b) => collator.compare(a, b));
    const infos = [];
    for (const file of files) {
      try {
        const info = fileInfo(file);
        if (info) infos.push(info);
      } catch {
        /* 읽을 수 없는 파일은 건너뜁니다 */
      }
    }
    return { dir, files: infos, truncated };
  });

  /**
   * 이름 변경·이동을 실제로 적용합니다.
   * 모두 검증한 뒤, 이름이 서로 맞바뀌는 경우도 안전하도록 임시 이름을 거쳐 옮깁니다.
   */
  defineApi('rename.apply', async (body) => {
    const entries = plan(body?.items);
    if (entries.length === 0) return { done: 0, failed: 0, results: [] };

    const stamp = `${Date.now().toString(36)}${process.pid.toString(36)}`;
    const staged = [];

    // 1단계: 같은 폴더 안 임시 이름으로 옮깁니다. 실패하면 되돌리고 중단합니다.
    try {
      for (let i = 0; i < entries.length; i += 1) {
        const entry = entries[i];
        const temp = path.join(path.dirname(entry.from), `.rename-${stamp}-${i}.tmp`);
        await fsp.rename(entry.from, temp);
        staged.push({ entry, temp });
      }
    } catch (err) {
      for (const { entry, temp } of staged) {
        try {
          await fsp.rename(temp, entry.from);
        } catch {
          /* 최선을 다해 되돌립니다 */
        }
      }
      throw new ApiError(
        `파일 이름을 바꾸지 못했습니다. (${err instanceof Error ? err.message : String(err)})\n파일이 사용 중인지 확인해 주세요. 이미 옮긴 파일은 원래대로 되돌렸습니다.`,
      );
    }

    // 2단계: 임시 이름에서 최종 이름·위치로.
    const results = [];
    for (const { entry, temp } of staged) {
      try {
        await moveFile(temp, entry.to);
        results.push({ from: entry.from, to: entry.to, toDir: entry.toDir, toName: entry.toName, ok: true });
      } catch (err) {
        let restored = true;
        try {
          await fsp.rename(temp, entry.from);
        } catch {
          restored = false;
        }
        results.push({
          from: entry.from,
          to: entry.from,
          toDir: path.dirname(entry.from),
          toName: path.basename(entry.from),
          ok: false,
          error: `${err instanceof Error ? err.message : String(err)}${restored ? '' : ` (원본이 ${temp} 로 남아 있습니다)`}`,
        });
      }
    }

    const done = results.filter((r) => r.ok).length;
    return { done, failed: results.length - done, results };
  });
}
