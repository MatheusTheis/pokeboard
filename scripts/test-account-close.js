// Cancela/confirmar o menu de aba e verifica que as sessões das outras contas não mudam.
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert/strict');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
const start = source.indexOf("ipcMain.on('pb:add-account'");
const end = source.indexOf('// Sessão salva por conta', start);
assert.ok(start >= 0 && end > start);
const handlers = {}, removed = [], closed = [], stopped = [];
let template, response = 0, saves = 0, layouts = 0, lastFocused = 2;
const makeView = slot => ({ slot, webContents: { close() { closed.push(slot); } } });
const views = [makeView(0), makeView(1), makeView(2)];
const state = { accountSlots: [0, 1, 2], accountCount: 3, focus: 2, layout: 'grid', accounts: [
  { name: 'Conta 1' }, { name: 'Conta 2' }, { name: 'Conta 3' }, { name: 'Conta 4' },
] };
const win = { webContents: {}, contentView: { removeChildView(v) { removed.push(v.slot); } } };
const loginRestored = new Set([0, 1, 2]), themeKeys = [];
const ctx = vm.createContext({
  ipcMain: { on(name, fn) { handlers[name] = fn; } },
  Menu: { buildFromTemplate(items) { template = items; return { popup() {} }; } },
  dialog: { async showMessageBox() { return { response }; } },
  views, state, win, loginRestored, themeKeys, MAX_ACCOUNTS: 4,
  indexOfSlot: slot => state.accountSlots.indexOf(slot), createView: makeView,
  stopAfk(slot, message, preserve) { stopped.push({ slot, preserve }); }, saveState() { saves++; }, layout() { layouts++; },
});
Object.defineProperty(ctx, 'lastFocused', { get: () => lastFocused, set: v => { lastFocused = v; } });
vm.runInContext(source.slice(start, end), ctx);

(async () => {
  handlers['pb:account-menu']({ sender: win.webContents }, 1);
  assert.equal(template[0].label, 'Fechar aba');
  await template[0].click();
  assert.deepEqual(state.accountSlots, [0, 1, 2], 'Cancelar preserva todas as abas');
  response = 1;
  handlers['pb:account-menu']({ sender: win.webContents }, 1);
  await template[0].click();
  assert.deepEqual(state.accountSlots, [0, 2], 'Conta 3 mantém o ID original');
  assert.deepEqual(views.map(v => v.slot), [0, 2]);
  assert.deepEqual(removed, [1]); assert.deepEqual(closed, [1]);
  assert.deepEqual(stopped, [{ slot: 1, preserve: true }], 'pausa só a aba fechada e guarda sua rota');
  assert.equal(state.focus, 1); assert.equal(lastFocused, 1);
  assert.equal(loginRestored.has(1), false, 'permite restaurar o login ao reabrir');
  handlers['pb:add-account']({ sender: win.webContents });
  assert.deepEqual(state.accountSlots, [0, 1, 2], 'reabre o slot vago na ordem original');
  assert.deepEqual(views.map(v => v.slot), [0, 1, 2]);
  assert.equal(state.focus, 2); assert.equal(lastFocused, 2);
  assert.ok(saves >= 2 && layouts >= 2);
  console.log('ok confirmação, fechamento e reabertura da aba por sessão');
})().catch(e => { console.error(e); process.exitCode = 1; });
