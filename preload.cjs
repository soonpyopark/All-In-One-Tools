const { contextBridge, ipcRenderer } = require('electron');

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
});