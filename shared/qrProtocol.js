/**
 * Tiny QRcode Generator 와 같은 QRT1 페이로드·URL 판별.
 * (zlib 은 fflate — 메인/렌더러 공용)
 */
import { zlibSync, unzlibSync } from 'fflate';

export const QR_MAGIC = 'QRT1';
export const QR_BORDER = 4;
export const QR_MAX_VERSION = 40;
/** Version 40, ECC L, byte mode 최대 용량 */
export const MAX_QR_BYTES = 2953;
export const MAX_QR_HANGUL = Math.floor(MAX_QR_BYTES / 3);
export const MIN_CAPTURE_SIDE = 80;

const URL_RE = /^(?:https?:\/\/|www\.)[^\s<>"']+$/i;

/** @param {Uint8Array} bytes */
function bytesToBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

/** @param {string} b64 */
function base64ToBytes(b64) {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

/**
 * @param {Uint8Array} data
 * @returns {number}
 */
export function textCrc32(data) {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) {
    crc ^= data[i];
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * 한 줄이 http(s) URL이면 정규화된 주소를 반환. 아니면 null.
 * @param {string} text
 * @returns {string | null}
 */
export function asHttpUrl(text) {
  const value = String(text ?? '').trim();
  if (!value || /[\r\n\t ]/.test(value)) return null;
  if (!URL_RE.test(value)) return null;
  if (value.toLowerCase().startsWith('www.')) return `https://${value}`;
  return value;
}

/**
 * @typedef {{
 *   originalSize: number,
 *   compressedSize: number,
 *   payload: string,
 *   payloadBytes: number,
 *   usedCompress: boolean,
 *   isUrl: boolean,
 * }} PackedText
 */

/**
 * UTF-8 텍스트를 zlib(+Base64)로 묶어 QRT1 ASCII 페이로드를 만든다.
 * @param {string} text
 * @param {boolean} [compress]
 * @returns {PackedText}
 */
export function encodeQrt1(text, compress = true) {
  const raw = new TextEncoder().encode(text);
  /** @type {Uint8Array} */
  let body;
  let used = false;
  let flag = '0';
  if (compress) {
    body = zlibSync(raw, { level: 9 });
    used = true;
    flag = '1';
  } else {
    body = raw;
  }
  const b64 = bytesToBase64(body);
  const payload = `${QR_MAGIC}|${flag}|${raw.length}|${textCrc32(raw).toString(16).toUpperCase().padStart(8, '0')}|${b64}`;
  const n = new TextEncoder().encode(payload).length;
  if (n > MAX_QR_BYTES && !used) return encodeQrt1(text, true);
  if (n > MAX_QR_BYTES) {
    throw new Error(
      `텍스트가 한 장의 단색 QR에 담기지 않습니다.\n\n원문: ${raw.length.toLocaleString()} bytes\n압축: ${body.length.toLocaleString()} bytes\n페이로드: ${n.toLocaleString()} / ${MAX_QR_BYTES} bytes\n내용을 나눠 보내 주세요.`,
    );
  }
  return {
    originalSize: raw.length,
    compressedSize: body.length,
    payload,
    payloadBytes: n,
    usedCompress: used,
    isUrl: false,
  };
}

/**
 * @param {string} payload
 * @returns {string}
 */
export function decodeQrt1(payload) {
  const text = String(payload ?? '').trim();
  if (!text.startsWith(`${QR_MAGIC}|`)) {
    throw new Error('이 QR은 텍스트 전송 형식(QRT1)이 아닙니다.');
  }
  const parts = text.split('|');
  if (parts.length < 5) throw new Error('페이로드 형식이 올바르지 않습니다.');
  const [, flag, sizeS, crcS, ...rest] = parts;
  const b64 = rest.join('|');
  try {
    const originalSize = Number(sizeS);
    const originalCrc = Number.parseInt(crcS, 16);
    const body = base64ToBytes(b64);
    const raw = flag === '1' ? unzlibSync(body) : body;
    if (raw.length !== originalSize || textCrc32(raw) !== originalCrc) {
      throw new Error('CRC32가 일치하지 않습니다. 다시 스캔해 주세요.');
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(raw);
  } catch (err) {
    if (err instanceof Error && /CRC32|형식|QRT1/.test(err.message)) throw err;
    throw new Error(`텍스트 복원에 실패했습니다: ${err instanceof Error ? err.message : err}`);
  }
}

/**
 * QR 페이로드 문자열을 원문으로 복원 (QRT1이면 압축 해제, 아니면 그대로).
 * @param {string} raw
 * @returns {string}
 */
export function restoreQrPayload(raw) {
  const text = String(raw ?? '');
  if (text.startsWith(`${QR_MAGIC}|`)) return decodeQrt1(text);
  return text;
}

/**
 * @param {number} rawLen
 * @param {boolean} [suggestCompress]
 */
export function overflowMessage(rawLen, suggestCompress = false) {
  const extra = suggestCompress
    ? '「긴 텍스트 자동 압축」을 켜거나 내용을 나눠 보내 주세요.'
    : '내용을 나눠 보내 주세요.';
  return (
    `텍스트가 한 장의 QR에 담기지 않습니다.\n\n` +
    `원문: ${rawLen.toLocaleString()} / ${MAX_QR_BYTES.toLocaleString()} bytes ` +
    `(한글 원문 최대 약 ${MAX_QR_HANGUL}자)\n${extra}`
  );
}

/**
 * 표시 영역에 맞는 정수 모듈 크기(px). 캡처 시 모듈이 깨지지 않게 한다.
 * @param {number} availPx
 * @param {number} canvasModules
 */
export function integerQrSide(availPx, canvasModules) {
  const canvas = Math.max(1, Math.floor(canvasModules));
  if (availPx < canvas) return Math.max(32, availPx);
  return Math.floor(availPx / canvas) * canvas;
}
