// Chat recolhido por conta: só o ícone permanece, e a escolha volta após recarregar.
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert/strict');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'inject', 'chat-plus.js'), 'utf8');
const saved = new Map([['pb:chat:hidden', '1']]);
const attrs = new Set();
let timer;
const nodes = {};
const game = { append(node) { node.parentNode = game; nodes[node.id] = node; }, querySelector(q) { return q === '.chat-box .chat-head' ? head : null; } };
const head = { append(node) { node.parentNode = head; nodes[node.id] = node; } };
const document = {
  documentElement: { toggleAttribute(k, on) { if (on) attrs.add(k); else attrs.delete(k); } },
  createElement() { return { addEventListener(name, fn) { this[name] = fn; }, setAttribute() {} }; },
  querySelector(q) { return q === '.game-root' ? game : null; },
};
const localStorage = { getItem: k => saved.get(k) ?? null, setItem: (k, v) => saved.set(k, v) };
vm.runInNewContext(source, { window: {}, document, localStorage, setInterval: fn => { timer = fn; } });
assert.ok(nodes['pb-chat-open'] && nodes['pb-chat-hide']);
assert.equal(nodes['pb-chat-open'].hidden, false);
assert.equal(attrs.has('data-pb-chat-hidden'), true);
nodes['pb-chat-open'].click();
assert.equal(attrs.has('data-pb-chat-hidden'), false);
nodes['pb-chat-hide'].click();
assert.equal(saved.get('pb:chat:hidden'), '1');
assert.equal(nodes['pb-chat-open'].hidden, false);
timer();
console.log('ok chat reduzido a ícone e estado salvo por conta');
