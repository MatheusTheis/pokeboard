// Teste isolado da fila: captura de uma espécie muda a hunt; só depois vêm as tipagens.
const fs = require('fs');
const vm = require('vm');
const assert = require('assert/strict');
const path = require('path');

const listeners = {};
const elements = {};
let tick, place = 'Cidade', flash = '', kills = 0;
const trips = [];
const head = { after(...nodes) { for (const n of nodes) { n.parentNode = task; task[n.id] = n; } } };
const task = { querySelector: q => q === '.prof-task-h' ? head : null };
const card = { querySelector: q => ({ small: { textContent: 'Derrotados' }, b: { textContent: String(kills) } })[q] };
const document = {
  createElement() {
    const el = { attrs: {}, addEventListener(type, fn) { el[type] = fn; },
      setAttribute(k, v) { el.attrs[k] = v; }, getAttribute(k) { return el.attrs[k]; },
      click() { el.clickHandler?.(); }, remove() { el.parentNode = null; } };
    const add = el.addEventListener;
    el.addEventListener = (type, fn) => { add(type, fn); if (type === 'click') el.clickHandler = fn; };
    return el;
  },
  querySelector(q) {
    if (q === '.prof-window .prof-task') return task;
    if (q === '.prof-window .prof-hname') return { textContent: 'Treinador de Prestígio' };
    if (q === '.phud-tloc') return { textContent: `Nível 150 · ${place}` };
    if (q === '.cap-flash') return { textContent: flash };
    return null;
  },
  querySelectorAll(q) { return q === '.ha-card' ? [card] : []; },
};
const cache = (data) => ({ data });
const window = {
  __pbCache: {
    '/api/game/professions': cache({ nextStep: { species: { have: 0, need: 2 }, kills: [
      { type: 'FIRE', have: 0, need: 2 }, { type: 'WATER', have: 0, need: 2 },
    ] } }),
    '/api/game/pokedex': cache({ species: [] }),
    '/game/creatures.json': cache({ creatures: [
      { pokeId: 1, name: 'Alpha', type1: 'FIRE' }, { pokeId: 2, name: 'Beta', type1: 'WATER' },
    ] }),
    '/api/game/map-markers': cache({ hunts: [
      { name: 'Alpha', level: 10, area: 'kanto' }, { name: 'Beta', level: 20, area: 'kanto' },
    ] }),
  },
  __pbDexHunts: {
    of(id) { return [{ name: id === 1 ? 'Alpha' : 'Beta', level: id === 1 ? 10 : 20, area: 'kanto' }]; },
    async travel(h) { trips.push(h.name); place = h.name; return true; },
  },
  addEventListener(type, fn) { listeners[type] = fn; },
};
const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'inject', 'prestige-auto.js'), 'utf8');
vm.runInNewContext(source, { window, document, fetch: () => {}, setTimeout, setInterval: fn => { tick = fn; } });
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  tick();
  const button = task['pb-prestige-auto'];
  // O botão montado fica no nó passado ao método after do cabeçalho.
  assert.ok(button, 'botão montado');
  flash = '🎉 Alpha capturado com Poké Ball!'; // log anterior não pode pular a primeira espécie
  button.click();
  await wait(0);
  assert.deepEqual(trips, ['Alpha']);
  tick(); await wait(0);
  assert.deepEqual(trips, ['Alpha']);
  flash = ''; tick();
  flash = '🎉 Alpha capturado com Poké Ball!'; tick(); await wait(1100);
  assert.deepEqual(trips, ['Alpha', 'Beta']);
  flash = '🎉 Beta capturado com Poké Ball!'; tick(); await wait(1100);
  assert.deepEqual(trips, ['Alpha', 'Beta', 'Alpha']);
  tick(); kills = 2; tick(); await wait(400);
  assert.deepEqual(trips, ['Alpha', 'Beta', 'Alpha', 'Beta']);
  button.click();
  assert.equal(button.getAttribute('aria-pressed'), 'false');
  console.log('ok fila de espécies, tipagens e parada');
})().catch(e => { console.error(e); process.exitCode = 1; });
