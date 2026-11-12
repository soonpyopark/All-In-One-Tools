/** OCR 변환(PDF & 이미지)이 받을 수 있는 확장자. */
export const OCR_IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.tif', '.tiff', '.gif'];
export const OCR_INPUT_EXTS = ['.pdf', ...OCR_IMAGE_EXTS];

/** @param {string} filePath */
export function isOcrInputPath(filePath) {
  const ext = String(filePath ?? '')
    .slice(String(filePath ?? '').lastIndexOf('.'))
    .toLowerCase();
  return OCR_INPUT_EXTS.includes(ext);
}

/** @param {string} filePath */
export function isOcrImagePath(filePath) {
  const ext = String(filePath ?? '')
    .slice(String(filePath ?? '').lastIndexOf('.'))
    .toLowerCase();
  return OCR_IMAGE_EXTS.includes(ext);
}
