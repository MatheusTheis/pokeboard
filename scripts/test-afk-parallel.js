// Valida duas rotas simultâneas no processo principal, com parada independente.
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert/strict');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
const start = source.indexOf("ipcMain.on('pb:afk-start'");
const end = source.indexOf("ipcMain.handle('pb:iv-ocr'", start);
assert.ok(start >= 0 && end > start);
const handlers = {}, events = [], polls = new Map(), ticks = [0, 0];
let nextPoll = 1, layouts = 0;
const webContents = [0, 1].map(i => ({
  send(name, value) { events.push({ i, name, value }); },
  isDestroyed: () => false,
  executeJavaScript() { ticks[i]++; return Promise.resolve(); },
}));
const win = { webContents: { send(name, value) { events.push({ i: 'shell', name, value }); } } };
const sessions = new Map();
const ctx = vm.createContext({
  ipcMain: { on(name, fn) { handlers[name] = fn; } },
  afkSessions: sessions, views: webContents.map(wc => ({ webContents: wc })), win,
  viewIndex: e => webContents.indexOf(e.sender), cleanRoute: x => x,
  layout() { layouts++; },
  setInterval(fn) { const id = nextPoll++; polls.set(id, fn); return id; },
  clearInterval(id) { polls.delete(id); },
});
vm.runInContext(source.slice(start, end), ctx);
const route = { pokemon: 'Pikachu', level: 1, target: 50 };
handlers['pb:afk-start']({ sender: webContents[0] }, { route, mode: 'dmg' });
handlers['pb:afk-start']({ sender: webContents[1] }, { route, mode: 'safe' });
assert.equal(sessions.size, 2);
assert.equal(polls.size, 2);
assert.equal(events.filter(e => e.name === 'pb:afk-on').length, 2);
for (const poll of polls.values()) poll();
assert.deepEqual(ticks, [1, 1]);

handlers['pb:afk-stop']({ sender: win.webContents }, 0);
assert.deepEqual([...sessions.keys()], [1]);
assert.equal(polls.size, 1);
assert.equal(events.filter(e => e.name === 'pb:afk-off' && e.i === 1).length, 0);
for (const poll of polls.values()) poll();
assert.deepEqual(ticks, [1, 2], 'segunda rota continua consultando o nível');

handlers['pb:afk-done']({ sender: webContents[1] }, 'Alvo alcançado');
assert.equal(sessions.size, 0);
assert.equal(polls.size, 0);
assert.equal(events.at(-1).value.account, 1);
assert.ok(layouts >= 4);
console.log('ok rotas AFK simultâneas e parada independente');
