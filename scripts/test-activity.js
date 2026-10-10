// Guarda só a última hunt e o Pokémon desta conta, sem registrar dados de login.
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert/strict');

let hunt = 'War Heracross', level = 150, tick, pagehide;
const saved = new Map();
const localStorage = { setItem: (k, v) => saved.set(k, v) };
const document = { querySelector(q) {
  if (q === '.game-root .phud-tloc') return { textContent: `Nível 150 · ${hunt}` };
  if (q === '.game-root .phud-mon.active') return { querySelector: s => ({
    '.phud-name': { textContent: 'Blastoise' }, '.phud-lv': { textContent: `Lv.${level}` },
  })[s] };
  return null;
} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'inject', 'activity.js'), 'utf8'), {
  window: { addEventListener(_, fn) { pagehide = fn; } }, document, localStorage,
  setInterval(fn) { tick = fn; }, Date,
});
const key = 'pb:last-activity:v1';
assert.equal(JSON.parse(saved.get(key)).hunt, 'War Heracross');
level = 151; tick();
assert.equal(JSON.parse(saved.get(key)).level, 151);
hunt = 'Cidade'; pagehide();
assert.equal(JSON.parse(saved.get(key)).hunt, 'Cidade');
assert.equal(saved.size, 1);
console.log('ok última atividade por conta ao mudar de hunt e fechar');
