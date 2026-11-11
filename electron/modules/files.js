/**
 * 공용 파일·폴더 경로 펼치기 API.
 */
import { ApiError, defineApi } from '../api/registry.js';
import { inspectPaths } from '../files/inspectPaths.js';

export function register() {
  defineApi('files.inspect', (body) => {
    try {
      return inspectPaths(body ?? {});
    } catch (err) {
      throw new ApiError(err instanceof Error ? err.message : String(err));
    }
  });
}
