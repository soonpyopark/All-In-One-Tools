/**
 * 런처: 프로그램·웹·폴더·파일 바로가기.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { BrowserWindow, app, dialog, shell } from 'electron';
import { APP_NAME } from '../../shared/constants.js';
import { ApiError, defineApi } from '../api/registry.js';
import { resolveDroppedPath } from '../launcher/resolveDrop.js';
import {
  addLauncherItems,
  listLauncherItems,
  removeLauncherItem,
  saveLauncherItems,
  upsertLauncherItem,
} from '../launcher/store.js';

const BACKUP_KIND = 'all-tools-launcher';

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

/**
 * @param {string} target
 * @returns {Promise<void>}
 */
async function openLocalPath(target) {
  const resolved = path.resolve(target);
  if (!fs.existsSync(resolved)) {
    throw new ApiError('대상을 찾을 수 없습니다.');
  }
  const err = await shell.openPath(resolved);
  if (err) throw new ApiError(err || '열기에 실패했습니다.');
}

/**
 * Windows 에서 .exe 는 분리 프로세스로 실행(앱이 기다리지 않음).
 * @param {string} target
 */
function spawnDetachedExe(target) {
  const resolved = path.resolve(target);
  if (!fs.existsSync(resolved)) throw new ApiError('프로그램을 찾을 수 없습니다.');
  const child = spawn(resolved, [], {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
    cwd: path.dirname(resolved),
  });
  child.unref();
}

export function register() {
  defineApi('launcher.list', () => ({ items: listLauncherItems() }));

  defineApi('launcher.save', async (body) => {
    const items = await saveLauncherItems(body?.items);
    return { items };
  });

  defineApi('launcher.upsert', async (body) => {
    try {
      const items = await upsertLauncherItem(body?.item ?? body);
      return { items };
    } catch (err) {
      throw new ApiError(err instanceof Error ? err.message : String(err));
    }
  });

  /** 탐색기·바탕화면에서 끌어다 놓은 경로들을 종류별로 바로 추가합니다. */
  defineApi('launcher.addFromPaths', async (body) => {
    const paths = Array.isArray(body?.paths)
      ? body.paths.map((entry) => String(entry ?? '').trim()).filter(Boolean)
      : [];
    if (paths.length === 0) throw new ApiError('추가할 항목이 없습니다.');

    /** @type {unknown[]} */
    const drafts = [];
    /** @type {string[]} */
    const failures = [];

    for (const filePath of paths.slice(0, 50)) {
      try {
        const resolved = resolveDroppedPath(filePath);
        drafts.push({
          type: resolved.type,
          title: resolved.title,
          target: resolved.target,
          group: 'general',
        });
      } catch (err) {
        failures.push(
          `${path.basename(filePath)}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    if (drafts.length === 0) {
      throw new ApiError(
        failures.length > 0
          ? `추가하지 못했습니다.\n${failures.slice(0, 5).join('\n')}`
          : '추가할 항목이 없습니다.',
      );
    }

    try {
      const result = await addLauncherItems(drafts);
      return {
        items: result.items,
        added: result.added,
        skipped: result.skipped + failures.length,
        failures: failures.slice(0, 8),
      };
    } catch (err) {
      throw new ApiError(err instanceof Error ? err.message : String(err));
    }
  });

  defineApi('launcher.remove', async (body) => {
    const id = String(body?.id ?? '');
    if (!id) throw new ApiError('삭제할 항목이 없습니다.');
    const items = await removeLauncherItem(id);
    return { items };
  });

  defineApi('launcher.open', async (body) => {
    const id = String(body?.id ?? '');
    const items = listLauncherItems();
    const item = items.find((entry) => entry.id === id);
    if (!item) throw new ApiError('바로가기를 찾을 수 없습니다.');

    try {
      if (item.type === 'url') {
        const url = item.target.trim();
        if (!/^https?:\/\//i.test(url)) throw new ApiError('허용되지 않은 주소입니다.');
        await shell.openExternal(url);
        return { ok: true };
      }

      if (item.type === 'app') {
        const ext = path.extname(item.target).toLowerCase();
        if (process.platform === 'win32' && (ext === '.exe' || ext === '.bat' || ext === '.cmd')) {
          spawnDetachedExe(item.target);
          return { ok: true };
        }
        await openLocalPath(item.target);
        return { ok: true };
      }

      // folder | file
      await openLocalPath(item.target);
      return { ok: true };
    } catch (err) {
      if (err instanceof ApiError) throw err;
      throw new ApiError(err instanceof Error ? err.message : '실행에 실패했습니다.');
    }
  });

  defineApi('launcher.exportBackup', async () => {
    const items = listLauncherItems();
    const win = appMainWindow();
    const result = await dialog.showSaveDialog(win ?? undefined, {
      title: '런처 목록 내보내기',
      defaultPath: path.join(app.getPath('documents'), `AllTools_launcher_${stamp()}.json`),
      filters: [{ name: '런처 목록 (JSON)', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) return { cancelled: true };

    let filePath = result.filePath;
    if (!/\.json$/i.test(filePath)) filePath = `${filePath}.json`;

    const payload = {
      version: 1,
      kind: BACKUP_KIND,
      exportedAt: new Date().toISOString(),
      items,
    };
    try {
      fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
      return { ok: true, filePath, count: items.length };
    } catch (err) {
      throw new ApiError(err instanceof Error ? err.message : '내보내기에 실패했습니다.');
    }
  });

  defineApi('launcher.importBackup', async (body) => {
    const mode = body?.mode === 'merge' ? 'merge' : 'replace';
    const win = appMainWindow();
    const result = await dialog.showOpenDialog(win ?? undefined, {
      title: '런처 목록 가져오기',
      properties: ['openFile'],
      filters: [{ name: '런처 목록 (JSON)', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePaths[0]) return { cancelled: true };

    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(result.filePaths[0], 'utf8'));
    } catch {
      throw new ApiError('파일을 읽을 수 없습니다. JSON 형식인지 확인하세요.');
    }

    const rawItems = Array.isArray(parsed?.items)
      ? parsed.items
      : Array.isArray(parsed)
        ? parsed
        : null;
    if (!rawItems) throw new ApiError('런처 목록 형식이 아닙니다. (items 배열 필요)');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && parsed.kind && parsed.kind !== BACKUP_KIND) {
      throw new ApiError('All In One Tools 런처 목록 파일이 아닙니다.');
    }

    /** @type {unknown[]} */
    let nextRaw = rawItems;
    if (mode === 'merge') {
      const current = listLauncherItems();
      const seen = new Set(current.map((item) => `${item.type}\0${item.target}`));
      const merged = [...current];
      for (const item of rawItems) {
        const type = item && typeof item === 'object' ? String(/** @type {any} */ (item).type ?? '') : '';
        const target = item && typeof item === 'object' ? String(/** @type {any} */ (item).target ?? '').trim() : '';
        const key = `${type}\0${target}`;
        if (!target || seen.has(key)) continue;
        seen.add(key);
        // 기존 id 충돌 방지: 새 항목으로 취급
        merged.push({ .../** @type {object} */ (item), id: undefined });
      }
      nextRaw = merged;
    }

    const items = await saveLauncherItems(nextRaw);
    return { ok: true, mode, count: items.length, items };
  });
}