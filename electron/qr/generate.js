/**
 * 텍스트/URL → 단색 QR (UTF-8 ECI, Tiny QRcode Generator 와 동일 정책).
 */
import { Byte, Charset, Encoder } from '@nuintun/qrcode';
import {
  QR_BORDER,
  QR_MAX_VERSION,
  asHttpUrl,
  encodeQrt1,
  overflowMessage,
} from '../../shared/qrProtocol.js';

/**
 * @typedef {{
 *   dataUrl: string,
 *   originalSize: number,
 *   payloadBytes: number,
 *   usedCompress: boolean,
 *   isUrl: boolean,
 *   qrVersion: number,
 *   eccLabel: string,
 *   canvasModules: number,
 *   moduleSize: number,
 * }} QrGenerateResult
 */

/**
 * @param {string} payload
 * @param {number} [modulePx]
 */
function renderMonoQr(payload, modulePx = 8) {
  const encoder = new Encoder({ level: 'L', version: 'Auto' });
  const needsEci = !/^[\x00-\x7F]*$/.test(payload);
  let encoded;
  try {
    encoded = encoder.encode(needsEci ? new Byte(payload, Charset.UTF_8) : new Byte(payload));
  } catch (err) {
    throw new Error(overflowMessage(new TextEncoder().encode(payload).length));
  }
  if (encoded.version > QR_MAX_VERSION) {
    throw new Error(overflowMessage(new TextEncoder().encode(payload).length));
  }
  const scale = Math.max(1, Math.floor(modulePx));
  const dataUrl = encoded.toDataURL(scale, {
    margin: QR_BORDER,
    foreground: [0, 0, 0],
    background: [255, 255, 255],
  });
  return {
    dataUrl,
    qrVersion: encoded.version,
    eccLabel: String(encoded.level || 'L').toUpperCase(),
    canvasModules: encoded.size + QR_BORDER * 2,
    moduleSize: scale,
  };
}

/**
 * @param {string} text
 * @param {{ compress?: boolean, modulePx?: number }} [options]
 * @returns {QrGenerateResult}
 */
export function buildTextQr(text, options = {}) {
  const compress = Boolean(options.compress);
  const modulePx = Number(options.modulePx) > 0 ? Number(options.modulePx) : 8;
  const url = asHttpUrl(text);
  if (url) {
    const raw = new TextEncoder().encode(url);
    const rendered = renderMonoQr(url, modulePx);
    return {
      ...rendered,
      originalSize: raw.length,
      payloadBytes: raw.length,
      usedCompress: false,
      isUrl: true,
    };
  }

  const raw = new TextEncoder().encode(text);
  try {
    const rendered = renderMonoQr(text, modulePx);
    return {
      ...rendered,
      originalSize: raw.length,
      payloadBytes: raw.length,
      usedCompress: false,
      isUrl: false,
    };
  } catch {
    if (!compress) throw new Error(overflowMessage(raw.length, true));
  }

  const packed = encodeQrt1(text, true);
  const rendered = renderMonoQr(packed.payload, modulePx);
  return {
    ...rendered,
    originalSize: packed.originalSize,
    payloadBytes: packed.payloadBytes,
    usedCompress: true,
    isUrl: false,
  };
}
