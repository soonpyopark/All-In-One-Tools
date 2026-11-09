import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { getSettings } from './settingsService.js';

/**
 * Resolve ffmpeg binary from settings.ffmpegDir, or fall back to PATH (`ffmpeg`).
 * @param {string} [ffmpegDir]
 * @returns {{ path: string, source: 'dir' | 'path' }}
 */
export function resolveFfmpegBinary(ffmpegDir = getSettings().ffmpegDir) {
  const dir = String(ffmpegDir ?? '').trim();
  if (dir) {
    const exeName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
    const candidate = path.join(dir, exeName);
    if (!fs.existsSync(candidate)) {
      throw new Error(`선택한 폴더에 ${exeName} 이(가) 없습니다.\n${candidate}`);
    }
    return { path: candidate, source: 'dir' };
  }
  return { path: process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg', source: 'path' };
}

/** Resolve ffprobe beside ffmpeg, or fall back to PATH. */
export function resolveFfprobeBinary(ffmpegDir = getSettings().ffmpegDir) {
  const ffmpeg = resolveFfmpegBinary(ffmpegDir);
  const probeName = process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe';
  if (ffmpeg.source === 'dir') {
    const candidate = path.join(path.dirname(ffmpeg.path), probeName);
    if (fs.existsSync(candidate)) return { path: candidate, source: 'dir' };
  }
  return { path: probeName, source: 'path' };
}

/**
 * @param {string} binary
 * @param {string[]} args
 * @param {{
 *   onStderr?: (chunk: string) => void,
 *   signal?: AbortSignal,
 *   cwd?: string,
 * }} [options]
 * @returns {Promise<{ code: number, stdout: string, stderr: string }>}
 */
export function runFfmpeg(binary, args, options = {}) {
  return new Promise((resolve, reject) => {
    /** @type {import('node:child_process').ChildProcessWithoutNullStreams} */
    let child;
    try {
      child = spawn(binary, args, {
        cwd: options.cwd,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
      return;
    }

    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (err, result) => {
      if (settled) return;
      settled = true;
      if (err) reject(err);
      else resolve(result);
    };

    const onAbort = () => {
      try {
        child.kill();
      } catch {
        // ignore
      }
      finish(new Error('변환이 취소되었습니다.'));
    };
    if (options.signal) {
      if (options.signal.aborted) {
        onAbort();
        return;
      }
      options.signal.addEventListener('abort', onAbort, { once: true });
    }

    child.stdout.on('data', (buf) => {
      stdout += String(buf);
    });
    child.stderr.on('data', (buf) => {
      const chunk = String(buf);
      stderr += chunk;
      options.onStderr?.(chunk);
    });
    child.on('error', (err) => {
      const message =
        err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT'
          ? 'ffmpeg 실행 파일을 찾을 수 없습니다. 환경설정에서 폴더를 지정하거나 PATH에 추가해 주세요.'
          : err instanceof Error
            ? err.message
            : String(err);
      finish(new Error(message));
    });
    child.on('close', (code) => {
      if (options.signal) options.signal.removeEventListener('abort', onAbort);
      finish(null, { code: code ?? 1, stdout, stderr });
    });
  });
}

/**
 * @param {string} [ffmpegDir]
 * @returns {Promise<{ ok: boolean, path: string, source: string, version: string, error?: string }>}
 */
export async function probeFfmpeg(ffmpegDir) {
  let resolved;
  try {
    resolved = resolveFfmpegBinary(ffmpegDir);
  } catch (err) {
    return {
      ok: false,
      path: '',
      source: 'dir',
      version: '',
      error: err instanceof Error ? err.message : String(err),
    };
  }

  try {
    const result = await runFfmpeg(resolved.path, ['-version']);
    if (result.code !== 0) {
      return {
        ok: false,
        path: resolved.path,
        source: resolved.source,
        version: '',
        error: result.stderr.trim() || `ffmpeg 종료 코드 ${result.code}`,
      };
    }
    const firstLine = result.stdout.split(/\r?\n/).find((line) => line.trim()) || '';
    return {
      ok: true,
      path: resolved.path,
      source: resolved.source,
      version: firstLine.trim(),
    };
  } catch (err) {
    return {
      ok: false,
      path: resolved.path,
      source: resolved.source,
      version: '',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Parse `time=HH:MM:SS.cs` from ffmpeg stderr for progress estimates.
 * @param {string} text
 * @returns {number | null} seconds
 */
export function parseFfmpegTimeSeconds(text) {
  const matches = [...String(text).matchAll(/time=(-?\d+):(\d+):(\d+(?:\.\d+)?)/g)];
  if (matches.length === 0) return null;
  const last = matches[matches.length - 1];
  const hours = Number(last[1]);
  const minutes = Number(last[2]);
  const seconds = Number(last[3]);
  if (![hours, minutes, seconds].every(Number.isFinite)) return null;
  return hours * 3600 + minutes * 60 + seconds;
}

/**
 * @typedef {{
 *   path: string,
 *   ok: boolean,
 *   fileSize: number,
 *   durationSec: number,
 *   width: number,
 *   height: number,
 *   error?: string,
 * }} MediaProbeInfo
 */

/**
 * Probe a media file with ffprobe (duration / size / resolution).
 * @param {string} inputPath
 * @returns {Promise<MediaProbeInfo>}
 */
export async function probeMediaFile(inputPath) {
  const resolved = path.resolve(String(inputPath ?? '').trim());
  if (!resolved || !fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    return {
      path: resolved,
      ok: false,
      fileSize: 0,
      durationSec: 0,
      width: 0,
      height: 0,
      error: '파일을 찾을 수 없습니다.',
    };
  }

  const fileSize = fs.statSync(resolved).size;
  let probe;
  try {
    probe = resolveFfprobeBinary();
  } catch (err) {
    return {
      path: resolved,
      ok: false,
      fileSize,
      durationSec: 0,
      width: 0,
      height: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  try {
    const result = await runFfmpeg(probe.path, [
      '-v',
      'quiet',
      '-print_format',
      'json',
      '-show_format',
      '-show_streams',
      resolved,
    ]);
    if (result.code !== 0) {
      return {
        path: resolved,
        ok: false,
        fileSize,
        durationSec: 0,
        width: 0,
        height: 0,
        error: result.stderr.trim() || 'ffprobe 실행에 실패했습니다.',
      };
    }

    /** @type {any} */
    let json = {};
    try {
      json = JSON.parse(result.stdout || '{}');
    } catch {
      return {
        path: resolved,
        ok: false,
        fileSize,
        durationSec: 0,
        width: 0,
        height: 0,
        error: 'ffprobe 결과를 해석하지 못했습니다.',
      };
    }

    const streams = Array.isArray(json.streams) ? json.streams : [];
    const video = streams.find((s) => s?.codec_type === 'video') ?? null;
    const width = Number(video?.width) || 0;
    const height = Number(video?.height) || 0;
    const durationFromFormat = Number(json.format?.duration);
    const durationFromStream = Number(video?.duration);
    const durationSec = Number.isFinite(durationFromFormat)
      ? durationFromFormat
      : Number.isFinite(durationFromStream)
        ? durationFromStream
        : 0;

    return {
      path: resolved,
      ok: true,
      fileSize,
      durationSec: Math.max(0, durationSec),
      width,
      height,
    };
  } catch (err) {
    const message =
      err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT'
        ? 'ffprobe 실행 파일을 찾을 수 없습니다. ffmpeg와 같은 폴더에 ffprobe가 있는지 확인해 주세요.'
        : err instanceof Error
          ? err.message
          : String(err);
    return {
      path: resolved,
      ok: false,
      fileSize,
      durationSec: 0,
      width: 0,
      height: 0,
      error: message,
    };
  }
}
