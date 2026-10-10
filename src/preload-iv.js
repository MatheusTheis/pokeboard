const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('ivBoard', { ocr: dataUrl => ipcRenderer.invoke('pb:iv-ocr', dataUrl) });
