import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { DEFAULT_PORT } from '../shared/constants.js';
import { ApiError, RawResponse, dispatchApi } from './api/registry.js';

/** The app is local-only: the server never listens on anything but loopback. */
const HOSTNAME = '127.0.0.1';

/** JSON request bodies are small (paths + options); nothing is uploaded. */
const MAX_BODY_BYTES = 8 * 1024 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
};

/**
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {unknown} payload
 */
function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(body);
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @returns {Promise<any>}
 */
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    /** @type {Buffer[]} */
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new ApiError('요청이 너무 큽니다.', 413));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (size === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new ApiError('올바른 JSON 요청이 아닙니다.', 400));
      }
    });
    req.on('error', reject);
  });
}

/**
 * There is no login, so the only thing protecting the API is that requests must
 * come from this app's own page:
 *  - `Host` must be 127.0.0.1 / localhost on our port (blocks DNS rebinding), and
 *  - a browser-supplied `Origin` must be that same origin (blocks other websites
 *    from posting to the local API).
 *
 * @param {import('node:http').IncomingMessage} req
 * @param {number} port
 */
function isTrustedRequest(req, port) {
  const host = String(req.headers.host ?? '').toLowerCase();
  const hosts = [`127.0.0.1:${port}`, `localhost:${port}`];
  if (!hosts.includes(host)) return false;

  const origin = req.headers.origin;
  if (origin === undefined) return true;
  return hosts.some((h) => origin === `http://${h}`);
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 */
async function handleApiRequest(req, res) {
  try {
    if (req.method !== 'POST') throw new ApiError('POST 요청만 지원합니다.', 405);
    const name = decodeURIComponent((req.url ?? '').split('?')[0].slice('/api/'.length));
    const body = await readJsonBody(req);
    const result = await dispatchApi(name, body);

    if (result instanceof RawResponse) {
      const headers = {
        'Content-Type': result.contentType,
        'Content-Length': result.buffer.length,
        'Cache-Control': 'no-store',
      };
      if (result.fileName) {
        headers['Content-Disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(result.fileName)}`;
      }
      res.writeHead(200, headers);
      res.end(result.buffer);
      return;
    }
    sendJson(res, 200, { ok: true, data: result ?? null });
  } catch (error) {
    if (error instanceof ApiError) {
      sendJson(res, error.status, { ok: false, error: error.message, ...error.extra });
      return;
    }
    console.error('[api] unexpected error:', error);
    sendJson(res, 500, {
      ok: false,
      error: error instanceof Error ? error.message : '서버 오류가 발생했습니다.',
    });
  }
}

/**
 * Serves the built renderer (production) with SPA fallback.
 *
 * @param {string} distDir
 * @returns {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => void}
 */
function createStaticHandler(distDir) {
  const root = path.resolve(distDir);

  return (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405).end();
      return;
    }

    let pathname = '/';
    try {
      pathname = decodeURIComponent((req.url ?? '/').split('?')[0]);
    } catch {
      res.writeHead(400).end();
      return;
    }

    let file = path.resolve(root, `.${pathname}`);
    if (file !== root && !file.startsWith(root + path.sep)) {
      res.writeHead(403).end();
      return;
    }
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      // Real asset requests 404; anything else is a client-side route.
      if (path.extname(pathname)) {
        res.writeHead(404).end('Not found');
        return;
      }
      file = path.join(root, 'index.html');
    }

    const ext = path.extname(file).toLowerCase();
    const isIndex = path.basename(file) === 'index.html';
    res.writeHead(200, {
      'Content-Type': MIME[ext] ?? 'application/octet-stream',
      'Cache-Control': isIndex
        ? 'no-cache'
        : pathname.startsWith('/assets/')
          ? 'public, max-age=31536000, immutable'
          : 'public, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    fs.createReadStream(file).pipe(res);
  };
}

/** @param {number} ms */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * @param {import('node:http').Server} server
 * @param {string} host
 * @param {number} port
 * @param {number} [retries] EADDRINUSE retries (the old process may still be exiting)
 */
async function listen(server, host, port, retries = 4) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await new Promise((resolve, reject) => {
        const onError = (err) => {
          server.off('listening', onListening);
          reject(err);
        };
        const onListening = () => {
          server.off('error', onError);
          resolve(undefined);
        };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(port, host);
      });
      return;
    } catch (err) {
      if (err?.code !== 'EADDRINUSE' || attempt >= retries) throw err;
      await sleep(700 * (attempt + 1));
    }
  }
}

/** @param {unknown} value */
function parsePort(value) {
  const port = Number.parseInt(String(value ?? '').trim(), 10);
  return Number.isInteger(port) && port >= 1024 && port <= 65535 ? port : null;
}

/**
 * Owns the one local web server of the app (loopback only, plain HTTP).
 * Dev: Vite (HMR) in middleware mode on this same port; production: static
 * files from `dist/`. The Electron window loads the UI from it and talks to
 * the backend through `POST /api/<name>`.
 *
 * @param {{
 *   isDev: boolean,
 *   projectRoot: string,
 *   distDir: string,
 *   env: { get: (key: string) => string | undefined },
 * }} options
 */
export function createServerManager({ isDev, projectRoot, distDir, env }) {
  /** @type {import('node:http').Server | null} */
  let server = null;
  /** @type {import('vite').ViteDevServer | null} */
  let vite = null;
  let running = false;
  let port = parsePort(env.get('APP_PORT')) ?? DEFAULT_PORT;
  /** @type {ReturnType<typeof createStaticHandler> | null} */
  let staticHandler = null;

  /**
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:http').ServerResponse} res
   */
  async function handleRequest(req, res) {
    if (!isTrustedRequest(req, port)) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Forbidden');
      return;
    }

    if ((req.url ?? '').startsWith('/api/')) {
      await handleApiRequest(req, res);
      return;
    }

    if (vite) {
      vite.middlewares(req, res);
      return;
    }
    staticHandler?.(req, res);
  }

  /** @param {import('node:http').IncomingMessage} req @param {import('node:stream').Duplex} socket */
  function handleUpgrade(req, socket) {
    // Vite HMR websocket: only this app's own page may connect.
    if (!isTrustedRequest(req, port)) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      socket.destroy();
    }
  }

  async function bringUp() {
    const next = http.createServer();
    next.on('request', (req, res) => {
      void handleRequest(req, res).catch((err) => {
        console.error('[http] request failed:', err);
        if (!res.headersSent) res.writeHead(500);
        res.end();
      });
    });
    next.on('upgrade', handleUpgrade);

    if (isDev) {
      const { createServer: createViteServer } = await import('vite');
      vite = await createViteServer({
        configFile: path.join(projectRoot, 'vite.config.js'),
        server: {
          middlewareMode: true,
          hmr: { server: next },
          allowedHosts: ['127.0.0.1', 'localhost'],
        },
        appType: 'spa',
      });
    } else {
      staticHandler ??= createStaticHandler(distDir);
    }

    try {
      await listen(next, HOSTNAME, port);
    } catch (err) {
      await vite?.close().catch(() => undefined);
      vite = null;
      throw err;
    }
    server = next;
    running = true;
    console.log(`[server] ${isDev ? 'dev (Vite HMR)' : 'production'} → http://${HOSTNAME}:${port}`);
  }

  async function tearDown() {
    running = false;
    if (vite) {
      await vite.close().catch(() => undefined);
      vite = null;
    }
    const old = server;
    server = null;
    if (!old) return;
    const closed = new Promise((resolve) => old.close(() => resolve(undefined)));
    old.closeAllConnections();
    await Promise.race([closed, sleep(3000)]);
  }

  function info() {
    return {
      running,
      port,
      hostname: HOSTNAME,
      appUrl: `http://${HOSTNAME}:${port}`,
      isDev,
    };
  }

  return {
    info,

    async start() {
      if (running) return info();
      await bringUp();
      return info();
    },

    async stop() {
      await tearDown();
    },
  };
}
