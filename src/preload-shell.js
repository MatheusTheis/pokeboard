// Ponte entre a interface do board (shell) e o processo principal.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('board', {
  getState: () => ipcRenderer.invoke('pb:get-state'),
  onLayout: cb => ipcRenderer.on('pb:layout', (_, data) => cb(data)),
  setLayout: l => ipcRenderer.send('pb:set-layout', l),
  focus: i => ipcRenderer.send('pb:focus', i),
  addAccount: () => ipcRenderer.send('pb:add-account'),
  accountMenu: slot => ipcRenderer.send('pb:account-menu', slot),
  zoom: (i, dir) => ipcRenderer.send('pb:zoom', i, dir),  // dir: 'in' | 'out' | 'auto'
  reload: i => ipcRenderer.send('pb:reload', i),
  reloadAll: () => ipcRenderer.send('pb:reload-all'),
  setSkin: on => ipcRenderer.send('pb:set-skin', on),  // true = visual PokeBoard, false = design original do jogo
  setFps: fps => ipcRenderer.send('pb:set-fps', fps),  // Economia: 0 (sem limite), 30 ou 20 quadros por segundo
  onMetrics: cb => ipcRenderer.on('pb:metrics', (_, data) => cb(data)),
  routeInfo: () => ipcRenderer.invoke('pb:route-info'),          // time da conta em foco e nomes dos Pokémon
  showRoute: q => ipcRenderer.send('pb:route-show', q),          // { pokemon, level, target } → janela no painel
  openRoute: q => ipcRenderer.send('pb:open-route', q),          // o mesmo → PIW Tools, numa janela própria
  openIv: () => ipcRenderer.send('pb:open-iv'),
  onAfk: cb => ipcRenderer.on('pb:afk', (_, data) => cb(data)),
  stopAfk: i => ipcRenderer.send('pb:afk-stop', i),
  devtools: i => ipcRenderer.send('pb:devtools', i),
  openTheme: () => ipcRenderer.send('pb:open-theme'),
  rename: (i, name) => ipcRenderer.send('pb:rename', i, name),
});
