const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  platform: process.platform,
  isDesktop: true,
  resetLocalData: () => ipcRenderer.invoke('desktop:reset-local-data'),
});
