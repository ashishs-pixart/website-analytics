const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cdp', {
  listTargets: (opts) => ipcRenderer.invoke('list-targets', opts),
  attachTarget: (opts) => ipcRenderer.invoke('attach-target', opts),
  getResponseBody: (opts) => ipcRenderer.invoke('get-response-body', opts),
  saveFile: (opts) => ipcRenderer.invoke('save-file', opts),
  selectCopilotDirectory: () => ipcRenderer.invoke('select-copilot-directory'),
  startCopilot: (opts) => ipcRenderer.invoke('start-copilot', opts),
  stopCopilot: () => ipcRenderer.invoke('stop-copilot'),
  startBrowserDebug: (opts) => ipcRenderer.invoke('start-browser-debug', opts),
  getExtensionData: () => ipcRenderer.invoke('get-extension-data'),
  clearExtensionData: () => ipcRenderer.invoke('clear-extension-data'),
  detach: () => ipcRenderer.invoke('detach'),
  onNetworkEvent: (callback) => ipcRenderer.on('network-event', (_event, data) => callback(data)),
  onTargetDisconnected: (callback) => ipcRenderer.on('target-disconnected', (_event, data) => callback(data)),
  onExportRequests: (callback) => ipcRenderer.on('export-requests', () => callback()),
  onShowHelp: (callback) => ipcRenderer.on('show-help', () => callback()),
  onCopilotEvent: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('copilot-event', listener);
    return () => ipcRenderer.removeListener('copilot-event', listener);
  },
  removeAllListeners: () => {
    ipcRenderer.removeAllListeners('network-event');
    ipcRenderer.removeAllListeners('target-disconnected');
    ipcRenderer.removeAllListeners('export-requests');
    ipcRenderer.removeAllListeners('show-help');
    ipcRenderer.removeAllListeners('copilot-event');
  },
});
