const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('IPCBridge', {
  addListener: (listener) => {
    ipcRenderer.on('ipc', listener);
    return listener;
  },
  removeListener: (listener) => {
    ipcRenderer.off('ipc', listener);
  },
  send: (data) => {
    ipcRenderer.send('ipc', data);
  },
  removeAllListeners: () => {
    ipcRenderer.removeAllListeners();
  },
});

contextBridge.exposeInMainWorld('env', {
  locale:
    process.argv.find((arg) => arg.startsWith('--locale='))?.split('=')[1] ??
    null,
  platform: process.platform,
  profileStartup: process.env.D2RMM_PROFILE_STARTUP === '1',
});

contextBridge.exposeInMainWorld('ElectronUtils', {
  getPathForFile: (file) => webUtils.getPathForFile(file),
});
