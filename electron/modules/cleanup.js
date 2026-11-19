import { ApiError, defineApi } from '../api/registry.js';
import { cancelCleanupJob, getCleanupJob, startCleanupJob } from '../cleanup/jobs.js';
import { EBOOK_INPUT_EXTS, previewEbookRegion } from '../cleanup/ebookExtract.js';

export function register() {
  defineApi('cleanup.tools', () => ({
    tools: [
      {
        id: 'ebook-extract',
        label: '이미지 자르기 & PDF 저장',
        description: '스크린샷 같은 이미지에서 특정 영역(예: 이북 화면)을 잘라 내고, 연속 유사 이미지는 제외합니다.',
        inputExts: EBOOK_INPUT_EXTS,
        minInputs: 1,
      },
      {
        id: 'pdf-dedup',
        label: 'PDF 중복페이지 정리',
        description: 'PDF에서 비슷한 페이지를 찾아 제거합니다. (연속 / 문서 전체)',
        inputExts: ['.pdf'],
        minInputs: 1,
      },
    ],
  }));

  /** First image (downscaled) + the automatically detected book region, for the region preview. */
  defineApi('cleanup.ebookPreview', async (body) => {
    const inputPaths = Array.isArray(body?.inputPaths) ? body.inputPaths : [];
    try {
      return await previewEbookRegion({ inputPaths });
    } catch (err) {
      throw new ApiError(err instanceof Error ? err.message : String(err));
    }
  });

  defineApi('cleanup.start', (body) => {
    try {
      const kind = body?.kind === 'ebook-extract' ? 'ebook-extract' : 'pdf-dedup';
      const inputPaths = Array.isArray(body?.inputPaths) ? body.inputPaths : [];
      const job = startCleanupJob({
        kind,
        inputPaths,
        outputDir: typeof body?.outputDir === 'string' ? body.outputDir : '',
        options: body?.options && typeof body.options === 'object' ? body.options : {},
      });
      return { job };
    } catch (err) {
      throw new ApiError(err instanceof Error ? err.message : String(err));
    }
  });

  defineApi('cleanup.status', (body) => {
    const job = getCleanupJob(body?.jobId);
    if (!job) throw new ApiError('작업을 찾을 수 없습니다.', 404);
    return { job };
  });

  defineApi('cleanup.cancel', (body) => {
    const job = cancelCleanupJob(body?.jobId);
    if (!job) throw new ApiError('작업을 찾을 수 없습니다.', 404);
    return { job };
  });
}
