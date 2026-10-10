// A troca só ocorre no Auto-Catch normal ligado e pela seleção nativa do jogo.
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert/strict');

let tick, modal = null, active = true, shiny = true, selected = 'Ultra Ball';
const counts = { 'Ultra Ball': 2, 'Super Ball': 3, 'Poké Ball': 4, 'Idle Ball': 1 };
const clicks = [];
const ball = n => ({
  getAttribute: k => k === 'title' ? n : '',
  querySelector: () => ({ textContent: String(counts[n]) }),
  classList: { contains: c => c === 'on' && selected === n },
  click() { clicks.push(n); selected = n; },
  disabled: false,
});
const balls = Object.keys(counts).map(ball);
const row = (label, isActive) => ({
  querySelector: q => q === '.ah-label' ? { textContent: label } :
    q === 'input[type="checkbox"]' ? { checked: isActive() } : null,
  nextElementSibling: { querySelectorAll: () => balls },
});
const normal = row('Auto-Catch', () => active);
const shinyRow = row('Auto-Catch Shiny', () => shiny);
const makeModal = () => ({
  querySelectorAll: () => [normal, shinyRow],
  querySelector: q => q === '.ah-modal-close' ? { click() { modal = null; } } : null,
});
let opens = 0;
const document = {
  querySelector: q => q === '.ah-modal' ? modal : q === '.ah-panel .ah-head' ? { click() { opens++; modal = makeModal(); } } : null,
  querySelectorAll: q => q === '.cap-panel .cap-balls .cap-chip' ? balls : [],
  addEventListener() {},
};
const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'inject', 'auto-ball.js'), 'utf8');
vm.runInNewContext(source, { window: {}, document, setInterval: fn => { tick = fn; }, setTimeout });
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

(async () => {
  tick(); await settle();
  assert.equal(opens, 1);
  assert.equal(modal, null, 'fecha apenas a consulta inicial');
  assert.deepEqual(clicks, [], 'não troca enquanto ainda há Ultra Balls');

  counts['Ultra Ball'] = 0;
  tick(); await settle();
  assert.deepEqual(clicks, ['Super Ball']);
  assert.equal(modal, null);
  counts['Super Ball'] = 0;
  tick(); await settle();
  assert.deepEqual(clicks, ['Super Ball', 'Poké Ball']);

  counts['Poké Ball'] = 0;
  tick(); await settle();
  assert.equal(clicks.length, 2, 'não escolhe Idle Ball nem bola sem estoque');

  active = false;
  selected = 'Ultra Ball';
  modal = makeModal();
  tick();
  assert.ok(modal, 'não fecha o Auto-Helper aberto pelo jogador');
  modal = null;
  counts['Super Ball'] = 5;
  tick(); await settle();
  assert.equal(clicks.length, 2, 'Auto-Catch desligado não troca');
  active = true;
  counts['Super Ball'] = 0;
  counts['Poké Ball'] = 5;
  modal = makeModal();
  tick();
  assert.equal(clicks.at(-1), 'Poké Ball', 'pula a Super Ball esgotada');
  modal = null;
  assert.equal(shiny, true, 'configuração shiny intacta');
  console.log('ok troca Ultra → Super → Poké apenas com Auto-Catch ligado');
})().catch(e => { console.error(e); process.exitCode = 1; });
