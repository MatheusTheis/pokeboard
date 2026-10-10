// Exercita o layout real com duas contas: AFK só deve ocultar o painel escolhido.
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert/strict');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
const layoutCode = source.slice(source.indexOf('function computeCells()'), source.indexOf("let sentLayout = '';"));
const layoutActions = source.slice(source.indexOf("let sentLayout = '';"), source.indexOf('function handleShortcut('));
const shortcutCode = source.slice(source.indexOf('function handleShortcut('), source.indexOf('const isGameUrl ='));
assert.ok(layoutCode.startsWith('function computeCells()'));
assert.ok(shortcutCode.startsWith('function handleShortcut('));
const visible = [null, null], events = [];
const views = [0, 1].map(i => ({
  setVisible(on) { visible[i] = on; }, setBounds() {},
  webContents: { isDestroyed: () => false, getZoomFactor: () => 1, setZoomFactor() {}, send() {}, focus() {} },
}));
const state = { layout: 'grid', focus: 0, zoomAdjust: [1, 1], accounts: [{}, {}] };
const ctx = vm.createContext({
  win: { getContentSize: () => [1500, 900], webContents: { send(_, data) { events.push(data); } } },
  views, state, afkSession: { account: 0 }, SIDEBAR_W: 0, TOPBAR_H: 36, GAP: 4,
  CELL_HEADER_H: 24, GAME_MIN_W: 1200, GAME_MIN_H: 650, ZOOM_MAX: 2, ZOOM_MIN: 0.25,
  ZOOM_STEP: 0.05, saveState() {},
});
vm.runInContext(layoutCode + layoutActions + shortcutCode, ctx);
vm.runInContext('layout()', ctx);
assert.deepEqual(visible, [false, true], 'a outra conta continua visível');
assert.equal(events.at(-1).cells[0].afkSlot, true);
assert.equal(events.at(-1).cells[1].afkSlot, false);

state.layout = 'focus'; state.focus = 1;
vm.runInContext('layout()', ctx);
assert.deepEqual(visible, [false, true], 'foco na outra conta continua disponível');
assert.equal(events.at(-1).cells[0].afkSlot, false, 'bloqueio não cobre a outra conta');

state.focus = 0;
let prevented = false;
ctx.input = { type: 'keyDown', control: true, alt: false, meta: false, key: '2' };
ctx.event = { preventDefault() { prevented = true; } };
vm.runInContext('handleShortcut(event, input)', ctx);
assert.equal(state.focus, 1, 'atalho do shell troca para outra conta durante AFK');
assert.equal(prevented, true);
state.focus = 0; prevented = false;
vm.runInContext('handleShortcut(event, input, 0, true)', ctx);
assert.equal(state.focus, 0, 'atalho vindo da conta em AFK fica bloqueado');
assert.equal(prevented, true);
console.log('ok AFK isolado por conta em grade, foco e atalhos');
