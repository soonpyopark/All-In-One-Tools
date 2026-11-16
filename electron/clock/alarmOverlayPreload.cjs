const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('alarmOverlay', {
  dismiss: () => ipcRenderer.invoke('alarm-overlay:dismiss'),
  /** @param {number} [minutes] */
  snooze: (minutes) => ipcRenderer.invoke('alarm-overlay:snooze', minutes ?? 5),
  /** @param {(payload: { kind: string, title: string }) => void} handler */
  onPayload: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on('alarm-overlay:payload', listener);
    return () => ipcRenderer.removeListener('alarm-overlay:payload', listener);
  },
});
