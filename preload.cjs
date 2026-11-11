const { contextBridge, ipcRenderer, webUtils } = require('electron');

/**
 * Bridge between the window and the main process. There is no network port:
 * backend calls (`api`) and native dialogs both go over Electron IPC.
 */
contextBridge.exposeInMainWorld('frame', {
  isElectron: true,
  /** Backend RPC → `{ ok, data }` or `{ ok: false, status, error }` (see main.js `api:call`). */
  api: (name, body) => ipcRenderer.invoke('api:call', name, body),
  getInfo: () => ipcRenderer.invoke('frame:getInfo'),
  openExternal: (url) => ipcRenderer.invoke('frame:openExternal', url),
  openStateFolder: (sub) => ipcRenderer.invoke('frame:openStateFolder', sub),
  pickDirectory: (options) => ipcRenderer.invoke('frame:pickDirectory', options),
  pickOpenFiles: (options) => ipcRenderer.invoke('frame:pickOpenFiles', options),
  showItemInFolder: (targetPath) => ipcRenderer.invoke('frame:showItemInFolder', targetPath),
  /** 끌어다 놓은 File 객체의 실제 경로 (파일 끌어놓기용). */
  getPathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return '';
    }
  },
});