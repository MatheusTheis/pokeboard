// A troca só ocorre no Auto-Catch normal ligado e pela seleção nativa do jogo.
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert/strict');

let tick, modal = null, active = true, shiny = true, selected = 'Ultra Ball';
let manualSelected = 'Poké Ball', shinySelected = 'Idle Ball';
const counts = { 'Ultra Ball': 2, 'Super Ball': 3, 'Poké Ball': 4, 'Idle Ball': 1 };
const clicks = [];
const ball = (n, kind = 'normal') => ({
  attrs: {},
  getAttribute: k => k === 'title' ? n : '',
  querySelector: () => ({ textContent: String(counts[n]) }),
  classList: { contains: c => c === 'on' && (kind === 'bar' ? manualSelected : kind === 'shiny' ? shinySelected : selected) === n },
  click() { if (kind === 'bar') manualSelected = n; else if (kind === 'shiny') shinySelected = n; else { clicks.push(n); selected = n; } },
  toggleAttribute(k, on) { if (on) this.attrs[k] = ''; else delete this.attrs[k]; },
  disabled: false,
});
const balls = Object.keys(counts).map(ball);
const shinyBalls = Object.keys(counts).map(n => ball(n, 'shiny'));
const barBalls = Object.keys(counts).map(n => ball(n, 'bar'));
const row = (label, isActive, options = balls) => ({
  querySelector: q => q === '.ah-label' ? { textContent: label } :
    q === 'input[type="checkbox"]' ? { checked: isActive() } : null,
  nextElementSibling: { querySelectorAll: () => options },
});
const normal = row('Auto-Catch', () => active);
const shinyRow = row('Auto-Catch Shiny', () => shiny, shinyBalls);
const makeModal = () => ({
  querySelectorAll: () => [normal, shinyRow],
  querySelector: q => q === '.ah-modal-close' ? { click() { modal = null; } } : null,
});
let opens = 0;
const listeners = {};
const panel = { attrs: {},
  querySelector: q => q === '.cap-head' ? { after(el) { el.parentNode = panel; } } : null,
  querySelectorAll: q => q === '.cap-balls .cap-chip' ? barBalls : [],
  toggleAttribute(k, on) { if (on) this.attrs[k] = ''; else delete this.attrs[k]; },
};
let indicator;
const document = {
  createElement() { indicator = { textContent: '', setAttribute() {}, parentNode: null }; return indicator; },
  querySelector: q => q === '.ah-modal' ? modal : q === '.cap-panel' ? panel : q === '.ah-panel .ah-head' ? { click() { opens++; modal = makeModal(); } } : null,
  querySelectorAll: q => q === '.cap-panel .cap-balls .cap-chip' ? barBalls : [],
  addEventListener(type, fn) { listeners[type] = fn; },
};
const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'inject', 'auto-ball.js'), 'utf8');
vm.runInNewContext(source, { window: {}, document, setInterval: fn => { tick = fn; }, setTimeout });
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

(async () => {
  tick(); await settle();
  assert.equal(opens, 1);
  assert.equal(modal, null, 'fecha apenas a consulta inicial');
  assert.deepEqual(clicks, [], 'não troca enquanto ainda há Ultra Balls');
  assert.match(indicator.textContent, /AUTO NORMAL · Ultra Ball · SHINY Idle Ball/);
  assert.ok('data-pb-auto-current' in barBalls[0].attrs, 'marca a bola do Auto-Catch, não a manual');

  manualSelected = 'Super Ball';
  listeners.click({ target: { closest: q => q === '.cap-panel .cap-balls .cap-chip' ? barBalls[1] : null } });
  await settle(); await settle();
  assert.equal(selected, 'Super Ball', 'clique na barra troca a bola padrão do Auto-Helper');
  assert.match(indicator.textContent, /AUTO NORMAL · Super Ball/);
  assert.equal(shinySelected, 'Idle Ball', 'clique normal não troca a bola shiny');
  selected = 'Ultra Ball';
  modal = makeModal(); tick(); modal = null;
  clicks.length = 0;

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
  assert.match(indicator.textContent, /MANUAL · Super Ball/);
  assert.equal('data-pb-auto-catch' in panel.attrs, false);
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
