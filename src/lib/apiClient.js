/**
 * Thin client for the local backend RPC (electron/api/registry.js).
 *
 *   const settings = await api('settings.get');
 *
 * The app is local-only: calls go to the Electron main process over IPC
 * (preload.cjs → `window.frame.api`). There is no server and no network port.
 */

export class ApiRequestError extends Error {
  /**
   * @param {string} message
   * @param {number} status
   * @param {Record<string, unknown>} [data]
   */
  constructor(message, status, data = {}) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

/**
 * @template [T=any]
 * @param {string} name
 * @param {unknown} [body]
 * @returns {Promise<T>}
 */
export async function api(name, body = {}) {
  const bridge = typeof window !== 'undefined' ? window.frame : undefined;
  if (!bridge?.api) {
    throw new ApiRequestError('이 화면은 All-Tools 프로그램 안에서만 사용할 수 있습니다.', 0);
  }

  /** @type {any} */
  let payload;
  try {
    payload = await bridge.api(name, body ?? {});
  } catch {
    throw new ApiRequestError('프로그램 내부 통신에 실패했습니다.', 0);
  }

  if (!payload?.ok) {
    throw new ApiRequestError(payload?.error || '요청에 실패했습니다.', payload?.status ?? 500, payload ?? {});
  }
  return payload.data;
}

/** Native bridge exposed by preload.cjs (file / folder pickers, reveal in folder). */
export function getNative() {
  return typeof window !== 'undefined' ? window.frame : undefined;
}