import { getNative } from './apiClient.js';

/**
 * 로컬 파일을 OS에 연결된 기본 프로그램으로 엽니다.
 * @param {string} filePath
 */
export async function openLocalFile(filePath) {
  const native = getNative();
  if (!native?.openPath) {
    throw new Error('파일 열기는 앱 안에서만 사용할 수 있습니다. 앱을 다시 시작해 주세요.');
  }
  const result = await native.openPath(filePath);
  if (result && result.ok === false) {
    throw new Error(result.error || '파일을 열지 못했습니다.');
  }
}

/**
 * 첨부 목록에서 더블클릭했을 때 파일을 열고, 실패하면 알림을 띄웁니다.
 * @param {string} filePath
 * @param {{ alert: (opts: { title: string, body: string }) => unknown }} [dialog]
 */
export function previewAttachedFile(filePath, dialog) {
  void openLocalFile(filePath).catch((err) => {
    const body = err instanceof Error ? err.message : '파일을 열지 못했습니다.';
    if (dialog?.alert) void dialog.alert({ title: '파일 열기', body });
  });
}
