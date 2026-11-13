const { contextBridge, ipcRenderer, webUtils } = require('electron');

/**
 * 플로팅 런처 전용 브리지 (메인 API + 창 전용 이벤트).
 */
contextBridge.exposeInMainWorld('floatingLauncher', {
  api: async (name, body) => {
    const payload = await ipcRenderer.invoke('api:call', name, body ?? {});
    if (!payload?.ok) {
      throw new Error(payload?.error || '요청에 실패했습니다.');
    }
    return payload.data;
  },
  onItems: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on('floating-launcher:items', listener);
    return () => ipcRenderer.removeListener('floating-launcher:items', listener);
  },
  onSettings: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on('floating-launcher:settings', listener);
    return () => ipcRenderer.removeListener('floating-launcher:settings', listener);
  },
  ready: () => ipcRenderer.send('floating-launcher:ready'),
  contextMenu: () => ipcRenderer.send('floating-launcher:context-menu'),
  moveBy: (dx, dy) => ipcRenderer.send('floating-launcher:move-by', dx, dy),
  /** 드래그 종료 시 최종 위치를 디스크에 바로 저장합니다. */
  moveEnd: () => ipcRenderer.send('floating-launcher:move-end'),
  setHover: (hovering) => ipcRenderer.send('floating-launcher:hover', Boolean(hovering)),
  /** 접기/펼치기 (작은 핸들만 남기기) */
  setCollapsed: (collapsed) => ipcRenderer.send('floating-launcher:set-collapsed', Boolean(collapsed)),
  /** 도움(?) 버튼 숨김 */
  setHideHelp: (hide) => ipcRenderer.send('floating-launcher:set-hide-help', Boolean(hide)),
  /** DOM 변경 후 창 크기 재측정 */
  requestResize: () => ipcRenderer.send('floating-launcher:resize'),
  /** 탐색기에서 끌어다 놓은 File 의 실제 경로 */
  getPathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return '';
    }
  },
});
