// Verifica o desempate do jogo sem abrir as contas reais: mesmo Q, maior IV primeiro.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'inject', 'quality-iv.js'), 'utf8');
let apply, skin = true;
const style = () => ({ order: '', removeProperty(k) { if (k === 'order') this.order = ''; } });
const el = (key, text, props = {}) => {
  const attrs = new Set();
  return {
    title: '', textContent: text, style: style(), __reactFiber$mock: { key, memoizedProps: props },
    matches: selector => selector.includes('.brd-box-poke') || selector.includes('.dpt-poke-row') || selector.includes('.mkt2-card'),
    hasAttribute: k => attrs.has(k), setAttribute: k => attrs.add(k), removeAttribute: k => attrs.delete(k),
  };
};
const pokes = [
  { id: 'a', quality: 1.8, ivTotal: 70 },
  { id: 'b', quality: 1.8, ivTotal: 150 },
  { id: 'c', quality: 1.7, ivTotal: 190 },
];
const list = (rows, data = pokes) => {
  const attrs = new Set();
  return {
    children: rows, __reactFiber$mock: { return: { type: function Window() {}, memoizedState: { memoizedState: [data, []], next: null } } },
    hasAttribute: k => attrs.has(k), setAttribute: k => attrs.add(k), removeAttribute: k => attrs.delete(k),
  };
};
const select = value => ({ value, options: [{ value: 'quality-desc' }] });
const breeding = list([el('a', 'IV 70 Q 1.800'), el('b', 'IV 150 Q 1.800'), el('c', 'IV 190 Q 1.700')]);
const breedSort = { value: 'quality' };
const depot = list([el('store-a', 'IV 70 Q 1.80'), el('store-b', 'IV 150 Q 1.80'), el('store-c', 'IV 190 Q 1.70')]);
const depotSort = select('quality-desc');
const market = list([el('m1', '', { l: { quality: 1.8, ivTotal: 70 } }), el('m2', '', { l: { quality: 1.8, ivTotal: 150 } }),
  el('m3', '', { l: { quality: 1.7, ivTotal: 190 } })], []);
const marketSort = select('quality-desc');
const windows = [
  { matches: s => s === '.brd-window', querySelector: s => s === '.brd-box' ? breeding : s === '.brd-box-sort' ? breedSort : null },
  { matches: s => s === '.dpt-window', querySelector: s => s === '.dpt-fbar, .trd-filters' ? { querySelectorAll: () => [depotSort] } : null,
    querySelectorAll: () => [depot] },
  { matches: s => s === '.mkt2-window', querySelector: s => s === '.mkt2-tab.on .mkt2-tab-label' ? { textContent: 'Comprar' }
    : s === '.mkt2-toolbar-row' ? { querySelectorAll: () => [marketSort] } : null, querySelectorAll: () => [market] },
];
const document = { documentElement: {}, querySelectorAll: () => windows };
vm.runInNewContext(source, { window: {}, document, getComputedStyle: () => ({ getPropertyValue: () => skin ? '#111' : '' }),
  setInterval: fn => { apply = fn; } });
const shown = container => container.children.map((row, i) => [row, +(row.style.order || i + 1)]).sort((a, b) => a[1] - b[1]).map(([row]) => row.__reactFiber$mock.key);
apply();
assert.deepEqual(shown(breeding), ['b', 'a', 'c'], 'Breeding: Q exato, depois IV');
assert.deepEqual(shown(depot), ['store-b', 'store-a', 'store-c'], 'Depósito: filtro de qualidade, depois IV');
assert.deepEqual(shown(market), ['m2', 'm1', 'm3'], 'Mercado: dados do anúncio, depois IV');
depotSort.value = 'iv-desc';
apply();
assert.equal(depot.hasAttribute('data-pb-quality-iv'), false, 'trocar ordenação restaura a do jogo');
skin = false;
apply();
assert.equal(breeding.hasAttribute('data-pb-quality-iv'), false, 'visual Original restaura a do jogo');
assert.equal(market.hasAttribute('data-pb-quality-iv'), false);
// A grade de Pokémon do Anunciar tem uma ordenação própria do PokeBoard além da ordem do jogo.
const plus = fs.readFileSync(path.join(__dirname, '..', 'src', 'inject', 'market-plus.js'), 'utf8');
const from = plus.indexOf('  function mountPokeValues(form) {');
const to = plus.indexOf('  // ---------- Anunciar › Pokémon: busca automática', from);
assert(from > 0 && to > from);
const mine = [
  { id: 'a', name: 'A', quality: 1.8, ivTotal: 70 },
  { id: 'b', name: 'B', quality: 1.8, ivTotal: 150 },
  { id: 'c', name: 'C', quality: 1.9, ivTotal: 40 },
];
const tiles = mine.map(p => ({ style: style(), __reactFiber$mock: { key: p.id }, setAttribute() {}, removeAttribute() {} }));
const game = select('quality-desc');
const bar = { querySelectorAll: () => [game] };
const pick = { previousElementSibling: { ...bar, matches: () => true }, querySelectorAll: () => tiles };
const form = { querySelector: () => pick, dataset: { pbKind: 'item' } };
const p = { similar: () => undefined, grade: () => 'Comum', GRADE_NAMES: ['Comum'] };
const context = { window: { __pbPrices: p }, pkSortSel: { parentElement: pick.previousElementSibling }, pkSort: '',
  myPokes: () => mine, fiberOf, setAttr: () => {}, compact: String };
// A função usa o mesmo helper de fibra do script do Mercado.
function fiberOf(row) { return row.__reactFiber$mock; }
vm.runInNewContext(`${plus.slice(from, to)}; mountPokeValues(form);`, { ...context, form });
assert.deepEqual(tiles.map((t, i) => [mine[i].id, +t.style.order]).sort((a, b) => a[1] - b[1]).map(x => x[0]),
  ['c', 'b', 'a'], 'Anunciar: qualidade numérica decrescente e IV no empate');
context.pkSort = 'rar-asc';
vm.runInNewContext(`${plus.slice(from, to)}; mountPokeValues(form);`, { ...context, form });
assert.deepEqual(tiles.map((t, i) => [mine[i].id, +t.style.order]).sort((a, b) => a[1] - b[1]).map(x => x[0]),
  ['b', 'a', 'c'], 'Anunciar: qualidade crescente e IV maior no empate');
console.log('ok qualidade + IV: Breeding, Depósito, Mercado Comprar/Anunciar; troca de ordem e Original');
