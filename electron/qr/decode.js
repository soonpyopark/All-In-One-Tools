/**
 * 캡처 이미지에서 단색 QR을 읽어 원문(또는 QRT1 복원 텍스트)을 돌려준다.
 */
import { Decoder, Detector, binarize, grayscale } from '@nuintun/qrcode';
import jsQR from 'jsqr';
import sharp from 'sharp';
import { MIN_CAPTURE_SIDE, restoreQrPayload } from '../../shared/qrProtocol.js';

/**
 * @param {import('electron').NativeImage} image
 * @returns {Promise<{ width: number, height: number, data: Uint8ClampedArray }>}
 */
async function toRgba(image) {
  const png = image.toPNG();
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8ClampedArray(data) };
}

/**
 * @param {{ width: number, height: number, data: Uint8ClampedArray }} rgba
 * @returns {string | null}
 */
function decodeWithNuintun(rgba) {
  const luminances = grayscale({ data: rgba.data, width: rgba.width, height: rgba.height });
  const matrix = binarize(luminances, rgba.width, rgba.height);
  const detector = new Detector();
  const detected = detector.detect(matrix);
  const decoder = new Decoder();
  let current = detected.next();
  while (!current.done) {
    let succeed = false;
    try {
      const decoded = decoder.decode(current.value.matrix);
      const content = String(decoded?.content ?? '');
      if (content) return content;
      succeed = true;
    } catch {
      // 다음 후보
    }
    current = detected.next(succeed);
  }
  return null;
}

/**
 * @param {{ width: number, height: number, data: Uint8ClampedArray }} rgba
 * @returns {string | null}
 */
function decodeWithJsQr(rgba) {
  try {
    const result = jsQR(rgba.data, rgba.width, rgba.height, { inversionAttempts: 'attemptBoth' });
    return result?.data ? String(result.data) : null;
  } catch {
    return null;
  }
}

/**
 * @param {{ width: number, height: number, data: Uint8ClampedArray }} rgba
 */
async function upscaled(rgba) {
  const maxSide = Math.max(rgba.width, rgba.height);
  if (maxSide >= 420) return null;
  const scale = 420 / maxSide;
  const width = Math.max(1, Math.round(rgba.width * scale));
  const height = Math.max(1, Math.round(rgba.height * scale));
  const { data, info } = await sharp(Buffer.from(rgba.data.buffer, rgba.data.byteOffset, rgba.data.byteLength), {
    raw: { width: rgba.width, height: rgba.height, channels: 4 },
  })
    .resize(width, height, { kernel: 'nearest' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8ClampedArray(data) };
}

/**
 * @param {import('electron').NativeImage} image
 * @returns {Promise<{ text: string | null, width: number, height: number, tooSmall: boolean }>}
 */
export async function decodeQrFromNativeImage(image) {
  if (!image || image.isEmpty()) {
    return { text: null, width: 0, height: 0, tooSmall: true };
  }
  const size = image.getSize();
  const tooSmall = Math.min(size.width, size.height) < MIN_CAPTURE_SIDE;
  const base = await toRgba(image);
  /** @type {Array<{ width: number, height: number, data: Uint8ClampedArray }>} */
  const candidates = [base];
  const bigger = await upscaled(base);
  if (bigger) candidates.push(bigger);

  for (const rgba of candidates) {
    const raw = decodeWithNuintun(rgba) ?? decodeWithJsQr(rgba);
    if (!raw) continue;
    try {
      return { text: restoreQrPayload(raw), width: size.width, height: size.height, tooSmall };
    } catch (err) {
      throw err instanceof Error ? err : new Error(String(err));
    }
  }
  return { text: null, width: size.width, height: size.height, tooSmall };
}
