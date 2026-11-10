const { contextBridge, ipcRenderer } = require('electron');

/** 영역 선택 오버레이 ↔ 메인 프로세스 통신 (선택 결과 / 취소만 전달) */
contextBridge.exposeInMainWorld('picker', {
  onInit: (callback) => ipcRenderer.on('region:init', (_event, data) => callback(data)),
  done: (rect) => ipcRenderer.send('region:done', rect),
  cancel: () => ipcRenderer.send('region:cancel'),
});
