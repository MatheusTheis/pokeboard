// Teste isolado da fila: captura de uma espécie muda a hunt; só depois vêm as tipagens.
const fs = require('fs');
const vm = require('vm');
const assert = require('assert/strict');
const path = require('path');

const listeners = {};
const elements = {};
let tick, place = 'Cidade', flash = '', kills = 0, professionOpen = true;
let dexWindow = null, dexOpens = 0, dexCloses = 0;
const trips = [];
const head = { after(...nodes) { for (const n of nodes) { n.parentNode = task; task[n.id] = n; } } };
const task = { querySelector: q => q === '.prof-task-h' ? head : null };
const game = { querySelector() { return null; }, append(node) { node.parentNode = game; if (node.id === 'pb-prestige-panel') game.panel = node; } };
const card = { querySelector: q => ({ small: { textContent: 'Derrotados' }, b: { textContent: String(kills) } })[q] };
const document = {
  createElement() {
    const children = new Map();
    const el = { attrs: {}, addEventListener(type, fn) { el[type] = fn; },
      setAttribute(k, v) { el.attrs[k] = v; }, getAttribute(k) { return el.attrs[k]; },
      toggleAttribute(k, on) { if (on) el.attrs[k] = ''; else delete el.attrs[k]; },
      querySelector(q) { if (!children.has(q)) children.set(q, { textContent: '', addEventListener() {} }); return children.get(q); },
      click() { el.clickHandler?.(); }, remove() { el.parentNode = null; } };
    const add = el.addEventListener;
    el.addEventListener = (type, fn) => { add(type, fn); if (type === 'click') el.clickHandler = fn; };
    return el;
  },
  querySelector(q) {
    if (q === '.game-root') return game;
    if (q === '.prof-window .prof-task') return professionOpen ? task : null;
    if (q === '.prof-window .prof-hname') return { textContent: 'Treinador de Prestígio' };
    if (q === '.phud-tloc') return { textContent: `Nível 150 · ${place}` };
    if (q === '.cap-flash') return { textContent: flash };
    if (q === '.dex-window') return dexWindow;
    if (q === '.dock-btn[data-guide="dock-pokedex"]') return { click() {
      dexOpens++;
      dexWindow = { querySelector: selector => selector === '.ds-x' ? { click() { dexCloses++; dexWindow = null; } } : null };
    } };
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
    '/api/game/pokedex': null,
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
const saved = new Map();
const localStorage = { getItem: k => saved.get(k) ?? null, setItem: (k, v) => saved.set(k, v), removeItem: k => saved.delete(k) };
const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'inject', 'prestige-auto.js'), 'utf8');
vm.runInNewContext(source, { window, document, localStorage, fetch: () => {}, setTimeout, setInterval: fn => { tick = fn; } });
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  tick();
  const button = task['pb-prestige-auto'];
  // O botão montado fica no nó passado ao método after do cabeçalho.
  assert.ok(button, 'botão montado');
  flash = '🎉 Alpha capturado com Poké Ball!'; // log anterior não pode pular a primeira espécie
  dexWindow = { querySelector: () => { throw new Error('não fechar janela do jogador'); } };
  button.click();
  await wait(0);
  assert.equal(dexOpens, 0, 'não interfere na Pokédex aberta pelo jogador');
  dexWindow = null;
  tick();
  assert.equal(dexOpens, 1, 'abre a Pokédex só para ler os dados iniciais');
  assert.equal(dexCloses, 0);
  window.__pbCache['/api/game/pokedex'] = cache({ species: [] });
  listeners['pb:data']({ detail: { path: '/api/game/pokedex' } });
  await wait(0);
  assert.equal(dexCloses, 1, 'fecha somente a Pokédex aberta pela automação');
  assert.equal(dexWindow, null);
  assert.deepEqual(trips, ['Alpha']);
  tick(); await wait(0);
  assert.deepEqual(trips, ['Alpha']);
  assert.equal(game.panel.hidden, false, 'progresso aparece fora da janela de profissões');
  assert.match(game.panel.querySelector('.pb-prestige-count').textContent, /Faltam 2 espécies/);
  assert.equal(JSON.parse(saved.get('pb:prestige:auto:v1')).hunt, 'Alpha');
  flash = ''; tick();
  flash = '🎉 Alpha capturado com Poké Ball!'; tick(); await wait(1100);
  assert.deepEqual(trips, ['Alpha', 'Beta']);
  assert.equal(dexOpens, 1, 'troca de hunt com a Pokédex fechada');
  flash = '🎉 Beta capturado com Poké Ball!'; tick(); await wait(1100);
  assert.deepEqual(trips, ['Alpha', 'Beta', 'Alpha']);
  tick(); kills = 2; tick(); await wait(400);
  assert.deepEqual(trips, ['Alpha', 'Beta', 'Alpha', 'Beta']);
  professionOpen = false; tick();
  assert.equal(button.getAttribute('aria-pressed'), 'true', 'abrir outra tela não para a rota');
  place = 'Cidade'; tick();
  assert.equal(button.getAttribute('aria-pressed'), 'false');
  assert.equal(saved.has('pb:prestige:auto:v1'), false, 'sair da hunt limpa a retomada');
  const previous = JSON.stringify({ hunt: 'Alpha', kind: 'catch', type: '', at: Date.now() });
  saved.set('pb:prestige:auto:v1', previous);
  place = 'Alpha'; window.__pbPrestigeAuto = false;
  vm.runInNewContext(source, { window, document, localStorage, fetch: () => {}, setTimeout, setInterval: fn => { tick = fn; } });
  tick(); await wait(0);
  assert.equal(game.panel.hidden, false, 'retoma se ainda estiver na mesma hunt');
  saved.set('pb:prestige:auto:v1', previous);
  place = 'Cidade'; window.__pbPrestigeAuto = false;
  vm.runInNewContext(source, { window, document, localStorage, fetch: () => {}, setTimeout, setInterval: fn => { tick = fn; } });
  tick();
  assert.equal(game.panel.hidden, true, 'não retoma em outra localização');
  assert.equal(saved.has('pb:prestige:auto:v1'), false);
  console.log('ok fila, progresso persistido e parada ao sair da hunt');
})().catch(e => { console.error(e); process.exitCode = 1; });
