/**
 * Tiny RPC registry. Every backend feature registers named handlers here;
 * main.js exposes them over Electron IPC (`api:call`) and the renderer calls
 * them with `api('<name>', body)` (src/lib/apiClient.js).
 *
 * The app is local-only: there is no server, no network port and no login,
 * so handlers receive no user / session context.
 *
 * @typedef {(body: any) => unknown | Promise<unknown>} ApiHandler
 */

/** Error whose message is shown to the user as-is (`status` is informational). */
export class ApiError extends Error {
  /**
   * @param {string} message
   * @param {number} [status]
   * @param {Record<string, unknown>} [extra]
   */
  constructor(message, status = 400, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

/** @type {Map<string, ApiHandler>} */
const routes = new Map();

/**
 * @param {string} name e.g. `settings.get`
 * @param {ApiHandler} handler
 */
export function defineApi(name, handler) {
  if (routes.has(name)) throw new Error(`API route registered twice: ${name}`);
  routes.set(name, handler);
}

/**
 * @param {string} name
 * @param {any} body
 */
export async function dispatchApi(name, body) {
  const handler = routes.get(name);
  if (!handler) throw new ApiError(`알 수 없는 요청입니다: ${name}`, 404);
  return handler(body ?? {});
}
