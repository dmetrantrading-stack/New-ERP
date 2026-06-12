const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  printReceipt: (html: string) => ipcRenderer.send('print-receipt', html),
  getAppPath: () => ipcRenderer.invoke('get-app-path'),
});
