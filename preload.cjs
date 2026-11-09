const { contextBridge, ipcRenderer } = require('electron');

/**
 * Native bridge for the Electron window (file / folder pickers, reveal in
 * folder). Everything else goes over the local HTTP API (src/lib/apiClient.js).
 */
contextBridge.exposeInMainWorld('frame', {
  isElectron: true,
  getInfo: () => ipcRenderer.invoke('frame:getInfo'),
  openExternal: (url) => ipcRenderer.invoke('frame:openExternal', url),
  openStateFolder: (sub) => ipcRenderer.invoke('frame:openStateFolder', sub),
  pickDirectory: () => ipcRenderer.invoke('frame:pickDirectory'),
  pickOpenFiles: (options) => ipcRenderer.invoke('frame:pickOpenFiles', options),
  showItemInFolder: (targetPath) => ipcRenderer.invoke('frame:showItemInFolder', targetPath),
});
