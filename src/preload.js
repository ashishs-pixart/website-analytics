const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cdp', {
  listTargets: (opts) => ipcRenderer.invoke('list-targets', opts),
  attachTarget: (opts) => ipcRenderer.invoke('attach-target', opts),
  getResponseBody: (opts) => ipcRenderer.invoke('get-response-body', opts),
  saveFile: (opts) => ipcRenderer.invoke('save-file', opts),
  startBrowserDebug: (opts) => ipcRenderer.invoke('start-browser-debug', opts),
  detach: () => ipcRenderer.invoke('detach'),
  onNetworkEvent: (callback) => ipcRenderer.on('network-event', (_event, data) => callback(data)),
  onTargetDisconnected: (callback) => ipcRenderer.on('target-disconnected', (_event, data) => callback(data)),
  onExportHar: (callback) => ipcRenderer.on('export-har', () => callback()),
  onShowHelp: (callback) => ipcRenderer.on('show-help', () => callback()),
  removeAllListeners: () => {
    ipcRenderer.removeAllListeners('network-event');
    ipcRenderer.removeAllListeners('target-disconnected');
    ipcRenderer.removeAllListeners('export-har');
    ipcRenderer.removeAllListeners('show-help');
  },
});
