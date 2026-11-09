/**
 * Thin client for the local backend RPC (electron/api/registry.js).
 *
 *   const settings = await api('settings.get');
 *
 * The app is local-only (no login): requests go to the 127.0.0.1 server that
 * also serves this page.
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
  let response;
  try {
    response = await fetch(`/api/${encodeURIComponent(name)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    });
  } catch {
    throw new ApiRequestError('서버에 연결할 수 없습니다.', 0);
  }

  if (!response.ok) {
    /** @type {any} */
    let payload = {};
    try {
      payload = await response.json();
    } catch {
      // non-JSON error body
    }
    throw new ApiRequestError(
      payload?.error || `요청에 실패했습니다. (HTTP ${response.status})`,
      response.status,
      payload,
    );
  }
  const payload = await response.json();
  return payload?.data;
}

/** Native bridge exposed by preload.cjs (file / folder pickers, reveal in folder). */
export function getNative() {
  return typeof window !== 'undefined' ? window.frame : undefined;
}
