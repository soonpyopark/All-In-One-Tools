import { ApiError, defineApi } from '../api/registry.js';
import {
  cancelConvertBatch,
  cancelConvertJob,
  getConvertBatch,
  getConvertJob,
  getExportDirInfo,
  listConvertJobs,
  resolveExportDir,
  startConvertJobs,
} from '../convertJobs.js';
import { listConverters } from '../converters/registry.js';
import { estimateGifSizeBatch } from '../gifSizeEstimate.js';
import { probeFfmpeg, probeMediaFile } from '../ffmpegService.js';
import { getSettings, updateSettings } from '../settingsService.js';

export function register() {
  defineApi('ffmpeg.probe', async (body) => {
    const dir =
      typeof body?.ffmpegDir === 'string' ? body.ffmpegDir.trim() : getSettings().ffmpegDir;
    return probeFfmpeg(dir);
  });

  defineApi('convert.probeMedia', async (body) => {
    const raw = Array.isArray(body?.paths) ? body.paths : body?.path ? [body.path] : [];
    const paths = [...new Set(raw.map((p) => String(p ?? '').trim()).filter(Boolean))];
    if (paths.length === 0) return { items: [] };
    if (paths.length > 50) throw new ApiError('한 번에 최대 50개까지 조회할 수 있습니다.');
    const items = [];
    for (const p of paths) {
      items.push(await probeMediaFile(p));
    }
    return { items };
  });

  /** Short sample encode → extrapolate full GIF size (more accurate than formula). */
  defineApi('convert.estimateSize', async (body) => {
    const raw = Array.isArray(body?.paths) ? body.paths : body?.path ? [body.path] : [];
    const paths = [...new Set(raw.map((p) => String(p ?? '').trim()).filter(Boolean))];
    if (paths.length === 0) {
      return { ok: false, method: 'none', originalBytes: 0, estimatedBytes: 0, items: [], label: '' };
    }
    if (paths.length > 20) throw new ApiError('용량 추정은 한 번에 최대 20개까지 가능합니다.');
    try {
      return await estimateGifSizeBatch({
        paths,
        options: body?.options && typeof body.options === 'object' ? body.options : {},
      });
    } catch (err) {
      throw new ApiError(err instanceof Error ? err.message : String(err));
    }
  });

  defineApi('convert.listConverters', () => ({
    converters: listConverters(),
  }));

  /** Prefill value for the output-folder field (resolved absolute path). */
  defineApi('convert.exportDir', () => getExportDirInfo());

  defineApi('convert.setExportDir', async (body) => {
    // Empty string = default (each video's own folder).
    const raw = typeof body?.exportDir === 'string' ? body.exportDir.trim() : '';
    if (raw) {
      try {
        resolveExportDir(raw);
      } catch (err) {
        throw new ApiError(err instanceof Error ? err.message : '저장 폴더를 만들 수 없습니다.');
      }
    }
    await updateSettings({ exportDir: raw });
    return getExportDirInfo();
  });

  defineApi('convert.start', (body) => {
    try {
      const result = startConvertJobs(body ?? {});
      return {
        batchId: result.batchId,
        jobs: result.jobs,
        job: result.jobs[0] ?? null,
      };
    } catch (err) {
      throw new ApiError(err instanceof Error ? err.message : String(err));
    }
  });

  defineApi('convert.status', (body) => {
    if (body?.batchId) {
      const batch = getConvertBatch(body.batchId);
      if (!batch) throw new ApiError('변환 배치를 찾을 수 없습니다.', 404);
      return { batch, job: batch.jobs[0] ?? null, jobs: batch.jobs };
    }
    const job = getConvertJob(body?.jobId);
    if (!job) throw new ApiError('변환 작업을 찾을 수 없습니다.', 404);
    return { job, jobs: [job], batch: getConvertBatch(job.batchId) };
  });

  defineApi('convert.cancel', (body) => {
    if (body?.batchId) {
      const batch = cancelConvertBatch(body.batchId);
      if (!batch) throw new ApiError('변환 배치를 찾을 수 없습니다.', 404);
      return { batch, jobs: batch.jobs, job: batch.jobs[0] ?? null };
    }
    const job = cancelConvertJob(body?.jobId);
    if (!job) throw new ApiError('변환 작업을 찾을 수 없습니다.', 404);
    return { job, jobs: [job], batch: getConvertBatch(job.batchId) };
  });

  defineApi('convert.listJobs', () => ({
    jobs: listConvertJobs(),
  }));
}
