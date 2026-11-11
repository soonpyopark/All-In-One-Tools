import { getNative } from './apiClient.js';

/**
 * 탐색기에서 끌어다 놓은 File 목록의 실제 경로를 반환한다.
 * @param {DragEvent} event
 * @returns {string[]}
 */
export function pathsFromDropEvent(event) {
  const native = getNative();
  const files = [...(event.dataTransfer?.files ?? [])];
  if (files.length === 0) return [];
  if (!native?.getPathForFile) return [];
  return files.map((file) => native.getPathForFile(file)).filter(Boolean);
}

/**
 * @param {DragEvent} event
 * @returns {boolean} getPathForFile 을 쓸 수 없으면 false
 */
export function canResolveDroppedFiles() {
  return Boolean(getNative()?.getPathForFile);
}
