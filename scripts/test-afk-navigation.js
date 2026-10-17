// O AFK só encerra numa recarga de verdade do painel: navegação dentro da página (pushState, #) e de iframes não.
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert/strict');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
const start = source.indexOf("wc.on('did-start-navigation'");
const end = source.indexOf("wc.on('render-process-gone'", start);
assert.ok(start >= 0 && end > start);
const listeners = {}, stopped = [];
vm.runInNewContext(source.slice(start, end), {
  slot: 1, wc: { on(name, fn) { listeners[name] = fn; } },
  afkSessions: new Map([[1, {}]]),
  stopAfk(slot, message) { stopped.push({ slot, message }); },
  stopPrestigePoll() {},
});
const nav = listeners['did-start-navigation'];
nav({ isMainFrame: true, isSameDocument: true, url: 'https://jogo/play?hunt=x' });
nav({ isMainFrame: true, isSameDocument: true, url: 'https://jogo/play#mapa' });
nav({ isMainFrame: false, isSameDocument: false, url: 'https://www.youtube.com/embed/x' });
assert.equal(stopped.length, 0, 'pushState, # e iframe não encerram o AFK');
nav({ isMainFrame: true, isSameDocument: false, url: 'https://jogo/play' });
assert.equal(stopped.length, 1, 'recarga do painel encerra o AFK');
assert.equal(stopped[0].slot, 1);
console.log('ok AFK segue em navegação dentro da página e de iframes');
