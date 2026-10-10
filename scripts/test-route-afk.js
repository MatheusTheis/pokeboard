// Simula duas faixas de nível sem abrir o jogo nem tocar nas contas reais.
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert/strict');

let level = 10, place = 'GrassA', timer = null;
const events = {}, sent = [], travels = [];
const html = { dataset: { pbAfkRoute: JSON.stringify({ pokemon: 'Flame', level: 10, target: 30, mode: 'dmg' }) } };
const document = {
  documentElement: html,
  createElement: () => ({ hidden: true, addEventListener() {}, querySelector() { return { value: 'safe' }; } }),
  querySelector(q) {
    if (q === '.game-root .phud-tloc') return { textContent: `Nível 100 · ${place}` };
    if (q === '.phud-mon.active') return { querySelector: s => ({ '.phud-name': { textContent: 'Flame' }, '.phud-lv': { textContent: `Lv.${level}` } })[s] };
    return null;
  },
};
const window = {
  __pbCache: {
    '/game/creatures.json': { data: { creatures: [
      { pokeId: 1, name: 'Flame', type1: 'FIRE', attacks: [{ type: 'FIRE', power: 40, learnLevel: 1 }] },
      { pokeId: 2, name: 'GrassA', type1: 'GRASS', attacks: [] },
      { pokeId: 3, name: 'GrassB', type1: 'GRASS', attacks: [] },
    ] } },
    '/api/game/map-markers': { data: { hunts: [
      { name: 'GrassA', level: 10, area: 'kanto' }, { name: 'GrassB', level: 20, area: 'kanto' },
    ] } },
  },
  __pbDexHunts: { async travel(h) { travels.push(h.name); place = h.name; return true; } },
  addEventListener(name, fn) { events[name] = fn; },
  dispatchEvent(e) { sent.push(e.type); },
};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'inject', 'route.js'), 'utf8'),
  { window, document, Event: class { constructor(type) { this.type = type; } },
    setInterval: fn => { timer = fn; return 1; }, clearInterval: () => { timer = null; }, Date, setTimeout });

(async () => {
  events['pb:afk-on']();
  assert.equal(travels.length, 0, 'primeira hunt já ativa');
  level = 20; await timer();
  assert.deepEqual(travels, ['GrassB'], 'mudou para a próxima hunt ao atingir o nível');
  await timer();
  level = 30; await timer();
  assert.ok(sent.includes('pb:afk-done'), 'desbloqueia ao chegar no alvo');
  assert.equal(timer, null);
  console.log('ok transição de hunt e encerramento AFK');
})().catch(e => { console.error(e); process.exitCode = 1; });
