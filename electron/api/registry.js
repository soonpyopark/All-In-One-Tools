/**
 * Tiny RPC registry. Every backend feature registers named handlers here;
 * the local HTTP server (electron/httpServer.js) exposes them as
 * `POST /api/<name>` and the renderer calls them with `api('<name>', body)`
 * (src/lib/apiClient.js).
 *
 * The app is local-only: the server listens on 127.0.0.1 and there is no
 * login, so handlers receive no user / session context.
 *
 * @typedef {(body: any) => unknown | Promise<unknown>} ApiHandler
 */

/** HTTP-aware error: the message is shown to the user as-is. */
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

/** Return this from a handler to send a file instead of JSON. */
export class RawResponse {
  /**
   * @param {Buffer} buffer
   * @param {{ fileName?: string, contentType?: string }} [options]
   */
  constructor(buffer, { fileName = '', contentType = 'application/octet-stream' } = {}) {
    this.buffer = buffer;
    this.fileName = fileName;
    this.contentType = contentType;
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
