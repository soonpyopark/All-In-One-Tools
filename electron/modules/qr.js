/**
 * QR 코드 생성기 API (Tiny QRcode Generator 이식).
 */
import fs from 'node:fs';
import path from 'node:path';
import { BrowserWindow, app, clipboard, dialog } from 'electron';
import sharp from 'sharp';
import { ApiError, defineApi } from '../api/registry.js';
import { hideAppWindows, restoreAppWindows } from '../capture/appWindows.js';
import { captureRegion } from '../capture/screenCapture.js';
import { pickRegion } from '../capture/regionPicker.js';
import { APP_NAME } from '../../shared/constants.js';
import { decodeQrFromNativeImage } from '../qr/decode.js';
import { hideQrFullscreen, showQrFullscreen } from '../qr/fullscreen.js';
import { buildTextQr } from '../qr/generate.js';

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${String(d.getFullYear()).slice(2)}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** @returns {BrowserWindow | null} */
function appMainWindow() {
  const wins = BrowserWindow.getAllWindows().filter((win) => !win.isDestroyed());
  return (
    wins.find((win) => win.getTitle().startsWith(APP_NAME) && !win.isFullScreen()) ??
    wins.find((win) => !win.isFullScreen()) ??
    null
  );
}

/** @param {unknown} err */
function toApiError(err) {
  if (err instanceof ApiError) return err;
  return new ApiError(err instanceof Error ? err.message : String(err));
}

/**
 * @param {import('electron').NativeImage} image
 */
function previewDataUrl(image) {
  try {
    return `data:image/png;base64,${image.toPNG().toString('base64')}`;
  } catch {
    return '';
  }
}

/**
 * @param {{ x: number, y: number, width: number, height: number }} region
 * @param {string} source
 */
async function scanAtRegion(region, source) {
  const image = await captureRegion(region);
  const decoded = await decodeQrFromNativeImage(image);
  return {
    cancelled: false,
    region,
    previewDataUrl: previewDataUrl(image),
    text: decoded.text,
    tooSmall: decoded.tooSmall,
    width: decoded.width,
    height: decoded.height,
    source,
  };
}

export function register() {
  defineApi('qr.generate', (body) => {
    const text = String(body?.text ?? '');
    if (!text.trim()) throw new ApiError('전송할 텍스트가 없습니다.');
    try {
      return buildTextQr(text, {
        compress: Boolean(body?.compress),
        modulePx: Number(body?.modulePx) || 8,
      });
    } catch (err) {
      throw toApiError(err);
    }
  });

  defineApi('qr.scanPick', async () => {
    const hidden = await hideAppWindows();
    try {
      const region = await pickRegion();
      if (!region) return { cancelled: true };
      return await scanAtRegion(region, '선택 영역');
    } catch (err) {
      throw toApiError(err);
    } finally {
      restoreAppWindows(hidden);
    }
  });

  defineApi('qr.scanRegion', async (body) => {
    const region = body?.region;
    if (
      !region ||
      !(Number(region.width) > 0) ||
      !(Number(region.height) > 0)
    ) {
      throw new ApiError('다시 스캔할 영역이 없습니다.');
    }
    try {
      return await scanAtRegion(
        {
          x: Math.round(Number(region.x)),
          y: Math.round(Number(region.y)),
          width: Math.round(Number(region.width)),
          height: Math.round(Number(region.height)),
        },
        String(body?.source ?? '다시 스캔'),
      );
    } catch (err) {
      throw toApiError(err);
    }
  });

  defineApi('qr.showFullscreen', (body) => {
    const dataUrl = String(body?.dataUrl ?? '');
    if (!dataUrl.startsWith('data:image/')) throw new ApiError('표시할 QR 이미지가 없습니다.');
    showQrFullscreen(dataUrl, Number(body?.canvasModules) || 29);
    return { ok: true };
  });

  defineApi('qr.hideFullscreen', () => {
    hideQrFullscreen();
    return { ok: true };
  });

  defineApi('qr.savePng', async (body) => {
    const dataUrl = String(body?.dataUrl ?? '');
    if (!dataUrl.startsWith('data:image/')) throw new ApiError('저장할 QR 이미지가 없습니다.');
    const comma = dataUrl.indexOf(',');
    const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : '';
    if (!b64) throw new ApiError('QR 이미지 데이터가 비어 있습니다.');

    const win = appMainWindow();
    const result = await dialog.showSaveDialog(win ?? undefined, {
      title: 'QR 저장하기',
      defaultPath: path.join(app.getPath('pictures'), `QR_${stamp()}.png`),
      filters: [{ name: 'PNG 이미지', extensions: ['png'] }],
    });
    if (result.canceled || !result.filePath) return { cancelled: true };

    let filePath = result.filePath;
    if (!/\.png$/i.test(filePath)) filePath = `${filePath}.png`;
    try {
      const png = await sharp(Buffer.from(b64, 'base64')).png().toBuffer();
      fs.writeFileSync(filePath, png);
      return { ok: true, filePath };
    } catch (err) {
      throw toApiError(err);
    }
  });

  defineApi('qr.clipboardRead', () => ({ text: clipboard.readText() || '' }));

  defineApi('qr.clipboardWrite', (body) => {
    const text = String(body?.text ?? '');
    clipboard.writeText(text);
    return { ok: true, length: text.length };
  });
}
