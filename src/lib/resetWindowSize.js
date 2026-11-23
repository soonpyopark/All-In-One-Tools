import { getNative } from './apiClient.js';

/**
 * 메인 창을 앱 최초 실행 크기로 되돌립니다. 실패해도 조용히 무시합니다.
 */
export async function resetWindowSize() {
  const native = getNative();
  if (!native?.resetWindowSize) return;
  try {
    await native.resetWindowSize();
  } catch {
    // 창 크기 복구 실패는 화면 초기화를 막지 않음
  }
}
