// Ponte entre a interface do board (shell) e o processo principal.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('board', {
  getState: () => ipcRenderer.invoke('pb:get-state'),
  onLayout: cb => ipcRenderer.on('pb:layout', (_, data) => cb(data)),
  setLayout: l => ipcRenderer.send('pb:set-layout', l),
  focus: i => ipcRenderer.send('pb:focus', i),
  zoom: (i, dir) => ipcRenderer.send('pb:zoom', i, dir),  // dir: 'in' | 'out' | 'auto'
  reload: i => ipcRenderer.send('pb:reload', i),
  reloadAll: () => ipcRenderer.send('pb:reload-all'),
  setSkin: on => ipcRenderer.send('pb:set-skin', on),  // true = visual PokeBoard, false = design original do jogo
  devtools: i => ipcRenderer.send('pb:devtools', i),
  openTheme: () => ipcRenderer.send('pb:open-theme'),
  rename: (i, name) => ipcRenderer.send('pb:rename', i, name),
});
