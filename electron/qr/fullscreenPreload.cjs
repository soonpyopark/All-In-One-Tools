const { contextBridge, ipcRenderer } = require('electron');

/** QR 전체 화면 ↔ 메인 */
contextBridge.exposeInMainWorld('qrFullscreen', {
  onInit: (callback) => ipcRenderer.on('qr:fullscreen-init', (_event, data) => callback(data)),
});
