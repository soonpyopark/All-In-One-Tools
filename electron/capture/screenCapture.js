import fs from 'node:fs';
import path from 'node:path';
import { desktopCapturer, screen } from 'electron';

/**
 * 화면 / 창 / 영역 캡처 (Electron `desktopCapturer`).
 *
 * 좌표계: 마우스(nut.js)와 영역 좌표는 Windows 에서는 실제 픽셀(물리 좌표), macOS 에서는 포인트입니다.
 * 이미지 픽셀 = 좌표 × `unit` 으로 변환합니다.
 *
 * @typedef {import('./presets.js').CaptureTarget} CaptureTarget
 * @typedef {import('./presets.js').Region} Region
 */

const isWin = process.platform === 'win32';

/**
 * 화면의 좌표계상 위치/크기와 캡처 이미지 크기.
 * @param {import('electron').Display} display
 */
export function displayGeometry(display) {
  if (isWin) {
    const rect = screen.dipToScreenRect(null, display.bounds);
    return {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      unit: 1,
      pixelWidth: rect.width,
      pixelHeight: rect.height,
    };
  }
  const scale = display.scaleFactor || 1;
  return {
    x: display.bounds.x,
    y: display.bounds.y,
    width: display.bounds.width,
    height: display.bounds.height,
    unit: scale,
    pixelWidth: Math.round(display.bounds.width * scale),
    pixelHeight: Math.round(display.bounds.height * scale),
  };
}

/** @param {number | null | undefined} displayId */
export function findDisplay(displayId) {
  const displays = screen.getAllDisplays();
  return displays.find((d) => d.id === displayId) ?? screen.getPrimaryDisplay();
}

/** 화면/창 선택 목록 (썸네일 없이 이름만). */
export async function listTargets() {
  const primaryId = screen.getPrimaryDisplay().id;
  const displays = screen.getAllDisplays().map((display, index) => {
    const geo = displayGeometry(display);
    return {
      id: display.id,
      label: `화면 ${index + 1}${display.id === primaryId ? ' (주 모니터)' : ''} · ${geo.pixelWidth}×${geo.pixelHeight}`,
      x: geo.x,
      y: geo.y,
      width: geo.width,
      height: geo.height,
    };
  });
  const sources = await desktopCapturer.getSources({
    types: ['window'],
    thumbnailSize: { width: 1, height: 1 },
  });
  const windows = sources
    .map((source) => source.name.trim())
    .filter((name, index, all) => name && all.indexOf(name) === index)
    .sort((a, b) => a.localeCompare(b, 'ko'));
  return { displays, windows };
}

/** @param {import('electron').Display} display */
export async function captureDisplay(display) {
  const geo = displayGeometry(display);
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: geo.pixelWidth, height: geo.pixelHeight },
  });
  const index = screen.getAllDisplays().findIndex((d) => d.id === display.id);
  const source =
    sources.find((s) => String(s.display_id) === String(display.id)) ??
    sources[index] ??
    sources[0];
  if (!source || source.thumbnail.isEmpty()) {
    throw new Error('화면을 캡처하지 못했습니다. (macOS 는 시스템 설정에서 화면 기록 권한을 허용해야 합니다.)');
  }
  return { image: source.thumbnail, geo };
}

/** 지정한 화면 전체를 캡처합니다. @param {number | null} displayId */
export async function captureScreen(displayId) {
  const { image } = await captureDisplay(findDisplay(displayId));
  return image;
}

/**
 * 좌표계상의 영역을 캡처합니다. 영역 중심이 속한 화면을 찾아 그 화면 이미지를 잘라 냅니다.
 * @param {Region} region
 */
export async function captureRegion(region) {
  const centerX = region.x + region.width / 2;
  const centerY = region.y + region.height / 2;
  const displays = screen.getAllDisplays();
  const display =
    displays.find((d) => {
      const geo = displayGeometry(d);
      return centerX >= geo.x && centerX < geo.x + geo.width && centerY >= geo.y && centerY < geo.y + geo.height;
    }) ?? screen.getPrimaryDisplay();

  const { image, geo } = await captureDisplay(display);
  const size = image.getSize();
  // 썸네일이 요청한 크기와 다르게 나올 수 있어 실제 크기 비율을 반영합니다.
  const ratioX = (size.width / geo.pixelWidth) * geo.unit;
  const ratioY = (size.height / geo.pixelHeight) * geo.unit;
  const x = Math.max(0, Math.round((region.x - geo.x) * ratioX));
  const y = Math.max(0, Math.round((region.y - geo.y) * ratioY));
  const width = Math.min(size.width - x, Math.round(region.width * ratioX));
  const height = Math.min(size.height - y, Math.round(region.height * ratioY));
  if (width < 1 || height < 1) throw new Error('캡처 영역이 화면 밖에 있습니다.');
  return image.crop({ x, y, width, height });
}

/** 제목이 같은(없으면 포함하는) 창을 캡처합니다. @param {string} title */
export async function captureWindow(title) {
  const wanted = String(title ?? '').trim().toLowerCase();
  if (!wanted) throw new Error('캡처할 창 제목을 지정해 주세요.');
  const sources = await desktopCapturer.getSources({
    types: ['window'],
    thumbnailSize: { width: 3840, height: 2160 },
  });
  const source =
    sources.find((s) => s.name.trim().toLowerCase() === wanted) ??
    sources.find((s) => s.name.toLowerCase().includes(wanted));
  if (!source) throw new Error(`창을 찾을 수 없습니다: ${title}\n(최소화된 창은 캡처할 수 없습니다.)`);
  if (source.thumbnail.isEmpty()) throw new Error(`창을 캡처하지 못했습니다: ${title}`);
  return source.thumbnail;
}

/**
 * 대상 설정에 맞게 캡처합니다.
 * @param {CaptureTarget} target
 */
export async function captureTarget(target) {
  if (target.mode === 'window') return captureWindow(target.windowTitle);
  if (target.mode === 'region') {
    if (!target.region) throw new Error('캡처 영역이 지정되지 않았습니다.');
    return captureRegion(target.region);
  }
  return captureScreen(target.displayId);
}

/**
 * 이미지를 파일로 저장합니다.
 * @param {import('electron').NativeImage} image
 * @param {string} filePath 확장자는 format 에 맞게 호출하는 쪽에서 정합니다.
 * @param {'png' | 'jpg'} format
 * @param {number} quality
 */
export function saveImage(image, filePath, format, quality) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, format === 'jpg' ? image.toJPEG(quality) : image.toPNG());
}

/** 비교용 지문의 가로 크기 (세로는 원본 비율). 너무 작으면 화면 일부만 바뀐 것을 놓칩니다. */
const SIGNATURE_WIDTH = 480;
/** 픽셀 밝기가 이 값보다 많이 달라지면 "바뀐 픽셀"로 셉니다. (0~255) */
const PIXEL_DELTA = 16;

/**
 * "같은 화면인지" 비교용 지문. 가로 480px 의 흑백 이미지입니다.
 * @param {import('electron').NativeImage} image
 * @returns {Uint8Array}
 */
export function imageSignature(image) {
  const size = image.getSize();
  const width = SIGNATURE_WIDTH;
  const height = Math.max(1, Math.round((width * size.height) / Math.max(1, size.width)));
  const bitmap = image.resize({ width, height, quality: 'good' }).toBitmap();
  const gray = new Uint8Array(width * height);
  for (let i = 0, p = 0; i + 3 < bitmap.length && p < gray.length; i += 4, p += 1) {
    // BGRA / RGBA 어느 쪽이어도 두 지문을 같은 방식으로 비교하므로 가중치 순서는 중요하지 않습니다.
    gray[p] = (bitmap[i] * 29 + bitmap[i + 1] * 150 + bitmap[i + 2] * 77) >> 8;
  }
  return gray;
}

/**
 * 두 지문에서 "바뀐 픽셀"의 비율(%, 0~100). 작을수록 같은 화면입니다.
 * 평균 차이가 아니라 바뀐 픽셀 수로 보기 때문에, 큰 화면의 일부(예: 책 페이지)만 바뀌어도 잡아냅니다.
 * @param {Uint8Array} a
 * @param {Uint8Array} b
 */
export function signatureDiff(a, b) {
  if (a.length !== b.length || a.length === 0) return 100;
  let changed = 0;
  for (let i = 0; i < a.length; i += 1) if (Math.abs(a[i] - b[i]) > PIXEL_DELTA) changed += 1;
  return (changed / a.length) * 100;
}
